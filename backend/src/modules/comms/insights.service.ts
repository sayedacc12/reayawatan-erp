import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { CONF_AR, CommsCore, DOC_AR, KIND_AR, PURPOSE_AR, TASK_STATUS_AR, TXN_STATUS_AR, today } from './comms-core.service';
import { COMMS_PERMISSIONS as P } from './comms.manifest';
import { TasksService } from './tasks.service';
import { TransactionsService } from './transactions.service';

/** لوحة الاتصالات الإدارية وبيانات التقارير */
@Injectable()
export class CommsInsights {
  constructor(
    private readonly db: DataSource,
    private readonly core: CommsCore,
    private readonly txns: TransactionsService,
    private readonly tasks: TasksService,
  ) {}

  async dashboard(actor: OrgUser) {
    const org = actor.organizationId;
    const [counts, inbox, myTasks, external] = await Promise.all([
      this.txns.counts(actor),
      this.txns.list(actor, { box: 'inbox' }).then((r) => r.items.slice(0, 6)),
      this.tasks.list(actor, { scope: 'mine', status: 'active' }),
      this.tasks.external(actor),
    ]);
    const out: Record<string, unknown> = {
      counts: { ...counts, tasks: myTasks.counts }, inbox, tasks: myTasks.items.slice(0, 6), external: external.slice(0, 6),
    };
    // نظرة عامة لمن يملك سجل المعاملات (على ما يحق له رؤيته فقط)
    if (this.core.can(actor, P.registry) || this.core.can(actor, P.registryMedium)) {
      const vis = this.core.visibleSql(actor, 2);
      const byHolder: { unit: string | null; open: number; overdue: number }[] = await this.db.query(
        `SELECT COALESCE(t.holder_unit_name, 'بدون إدارة') AS unit, COUNT(*)::int AS open, COUNT(*) FILTER (WHERE t.due_date < $3)::int AS overdue
           FROM comms_transactions t WHERE t.organization_id = $1 AND t.status = 'open' AND ${vis} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, [org, actor.id, today()],
      );
      const [tot] = await this.db.query(
        `SELECT COUNT(*) FILTER (WHERE t.status = 'open')::int AS open, COUNT(*) FILTER (WHERE t.status IN ('closed','archived'))::int AS done,
                COUNT(*) FILTER (WHERE t.status = 'open' AND t.due_date < $3)::int AS overdue,
                COUNT(*) FILTER (WHERE t.kind = 'financial' AND t.status = 'open')::int AS financial_open,
                COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'financial' AND t.status = 'open'), 0)::float AS financial_amount,
                COUNT(*) FILTER (WHERE t.doc_type <> 'transaction' AND t.status = 'issued')::int AS decisions,
                ROUND(AVG(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)) / 86400) FILTER (WHERE t.closed_at IS NOT NULL)::numeric, 1)::float AS avg_days
           FROM comms_transactions t WHERE t.organization_id = $1 AND ${vis}`, [org, actor.id, today()],
      );
      out.registry = { ...tot, byHolder };
    }
    if (this.core.can(actor, P.tasksAll)) {
      const [t] = await this.db.query(
        `SELECT COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open, COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND due_date < $2)::int AS overdue,
                COUNT(*) FILTER (WHERE status = 'done')::int AS done, COUNT(*) FILTER (WHERE source_type = 'meeting')::int AS from_meetings
           FROM comms_tasks WHERE organization_id = $1 AND NOT is_confidential`, [org, today()],
      );
      out.allTasks = t;
    }
    return out;
  }

  // ---------------- بيانات التقارير ----------------

  /** سجل المعاملات (على ما يحق للمستخدم رؤيته) */
  async registry(actor: OrgUser, f: { from?: string; to?: string; docType?: string; kind?: string; status?: string; confidentiality?: string }) {
    const rows = await this.db.query(
      `SELECT t.id, t.ref_no, t.doc_type, t.kind, t.direction, t.category_name, t.subject, t.confidentiality, t.priority, t.status, t.created_by_name,
              t.origin_unit_name, t.holder_name, t.holder_unit_name, t.due_date::text, t.amount::float, t.voucher_serial, t.created_at, t.closed_at
         FROM comms_transactions t WHERE t.organization_id = $1 AND ${this.core.visibleSql(actor, 2)} AND t.status <> 'draft'
          AND t.created_at::date BETWEEN $3 AND $4 AND ($5::text IS NULL OR t.doc_type = $5) AND ($6::text IS NULL OR t.kind = $6)
          AND ($7::text IS NULL OR t.status = $7) AND ($8::text IS NULL OR t.confidentiality = $8)
        ORDER BY t.created_at`,
      [actor.organizationId, actor.id, f.from, f.to, f.docType ?? null, f.kind ?? null, f.status ?? null, f.confidentiality ?? null],
    );
    return rows.map((r: Record<string, any>) => ({
      id: r.id, refNo: r.ref_no, docType: DOC_AR[r.doc_type], kind: KIND_AR[r.kind], category: r.category_name, subject: r.subject, confidentiality: CONF_AR[r.confidentiality],
      status: TXN_STATUS_AR[r.status], createdBy: r.created_by_name, origin: r.origin_unit_name, holder: r.status === 'open' ? `${r.holder_name ?? ''}${r.holder_unit_name ? ` (${r.holder_unit_name})` : ''}` : null,
      dueDate: r.due_date, amount: r.amount, voucher: r.voucher_serial, createdAt: r.created_at, closedAt: r.closed_at,
      overdue: r.status === 'open' && r.due_date && r.due_date < today() ? 'نعم' : null,
    }));
  }

  /** المعاملات المتأخرة عند الجهات */
  async overdue(actor: OrgUser) {
    const rows = await this.db.query(
      `SELECT t.id, t.ref_no, t.subject, t.confidentiality, t.holder_name, t.holder_unit_name, t.holder_purpose, t.holder_since, t.due_date::text, ($3::date - t.due_date)::int AS late
         FROM comms_transactions t WHERE t.organization_id = $1 AND ${this.core.visibleSql(actor, 2)} AND t.status = 'open' AND t.due_date < $3 ORDER BY t.due_date`,
      [actor.organizationId, actor.id, today()],
    );
    return rows.map((r: Record<string, any>) => ({
      id: r.id, refNo: r.ref_no, subject: r.subject, confidentiality: CONF_AR[r.confidentiality], holder: r.holder_name, unit: r.holder_unit_name,
      purpose: r.holder_purpose ? PURPOSE_AR[r.holder_purpose] : null, since: r.holder_since, dueDate: r.due_date, late: r.late,
    }));
  }

  /** أداء الإدارات في إنجاز المعاملات */
  async unitPerformance(actor: OrgUser, f: { from?: string; to?: string }) {
    return this.db.query(
      `WITH mv AS (
         SELECT t.id, m->>'toUnitName' AS unit, (m->>'at')::timestamptz AS at, t.status, t.due_date, t.holder_unit_name
           FROM comms_transactions t, jsonb_array_elements(t.movements) m
          WHERE t.organization_id = $1 AND ${this.core.visibleSql(actor, 2)} AND m->>'kind' = 'refer' AND (m->>'at')::date BETWEEN $3 AND $4)
       SELECT COALESCE(unit, 'بدون إدارة') AS unit, COUNT(*)::int AS received, COUNT(DISTINCT id)::int AS transactions,
              COUNT(DISTINCT id) FILTER (WHERE status = 'open' AND holder_unit_name = unit)::int AS pending,
              COUNT(DISTINCT id) FILTER (WHERE status = 'open' AND holder_unit_name = unit AND due_date < $5)::int AS overdue
         FROM mv GROUP BY 1 ORDER BY 2 DESC`,
      [actor.organizationId, actor.id, f.from, f.to, today()],
    );
  }

  /** المهام حسب الحالة والمسؤول */
  async taskList(actor: OrgUser, f: { from?: string; to?: string; status?: string; source?: string }) {
    const all = this.core.can(actor, P.tasksAll);
    const rows = await this.db.query(
      `SELECT id, ref_no, title, owner_name, owner_unit_name, assigned_by_name, source_type, source_ref, start_date::text, due_date::text, original_due_date::text,
              status, progress, completed_at, jsonb_array_length(supporters)::int AS supporters
         FROM comms_tasks WHERE organization_id = $1 AND created_at::date BETWEEN $2 AND $3
          AND (${all ? 'NOT is_confidential OR ' : ''}owner_user_id = $4 OR assigned_by_id = $4 OR $4 = ANY(supporter_user_ids))
          AND ($5::text IS NULL OR status = $5) AND ($6::text IS NULL OR source_type = $6)
        ORDER BY due_date`,
      [actor.organizationId, f.from, f.to, actor.id, f.status ?? null, f.source ?? null],
    );
    const t = today();
    return rows.map((r: Record<string, any>) => ({
      id: r.id, refNo: r.ref_no, title: r.title, owner: r.owner_name, unit: r.owner_unit_name, assignedBy: r.assigned_by_name, source: r.source_ref ?? 'مهمة مباشرة',
      startDate: r.start_date, dueDate: r.due_date, extended: r.due_date !== r.original_due_date ? 'نعم' : null, status: TASK_STATUS_AR[r.status], progress: r.progress,
      supporters: r.supporters, completedAt: r.completed_at, overdue: ['open', 'in_progress'].includes(r.status) && r.due_date < t ? 'نعم' : null,
    }));
  }

  /** إنجاز المهام حسب المسؤول */
  async tasksByOwner(actor: OrgUser, f: { from?: string; to?: string }) {
    const all = this.core.can(actor, P.tasksAll);
    const rows = await this.db.query(
      `SELECT owner_name AS owner, MAX(owner_unit_name) AS unit, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'done')::int AS done,
              COUNT(*) FILTER (WHERE status = 'done' AND completed_at::date <= due_date)::int AS on_time,
              COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open, COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND due_date < $4)::int AS overdue,
              COUNT(*) FILTER (WHERE due_date <> original_due_date)::int AS extended
         FROM comms_tasks WHERE organization_id = $1 AND created_at::date BETWEEN $2 AND $3 AND status <> 'cancelled'
          AND (${all ? 'NOT is_confidential OR ' : ''}owner_user_id = $5 OR assigned_by_id = $5)
        GROUP BY owner_user_id, owner_name ORDER BY total DESC`,
      [actor.organizationId, f.from, f.to, today(), actor.id],
    );
    return rows.map((r: Record<string, number | string>) => ({
      ...r, completion: Number(r.total) ? Math.round((Number(r.done) / Number(r.total)) * 1000) / 10 : 0,
      onTimeRate: Number(r.done) ? Math.round((Number(r.on_time) / Number(r.done)) * 1000) / 10 : 0,
    }));
  }

  /** اطلاع الموجه إليهم على القرارات والتعاميم */
  async decisionsRead(actor: OrgUser, f: { from?: string; to?: string }) {
    const rows = await this.db.query(
      `SELECT t.id, t.ref_no, t.doc_type, t.subject, t.confidentiality, t.issued_at, t.created_by_name, jsonb_array_length(t.recipients)::int AS total,
              (SELECT COUNT(*) FROM jsonb_array_elements(t.recipients) r WHERE r->>'readAt' IS NOT NULL)::int AS read
         FROM comms_transactions t WHERE t.organization_id = $1 AND ${this.core.visibleSql(actor, 2)} AND t.doc_type <> 'transaction' AND t.status = 'issued'
          AND t.issued_at::date BETWEEN $3 AND $4 ORDER BY t.issued_at`, [actor.organizationId, actor.id, f.from, f.to],
    );
    return rows.map((r: Record<string, any>) => ({
      id: r.id, refNo: r.ref_no, docType: DOC_AR[r.doc_type], subject: r.subject, confidentiality: CONF_AR[r.confidentiality], issuedAt: r.issued_at, by: r.created_by_name,
      total: r.total, read: r.read, unread: r.total - r.read, rate: r.total ? Math.round((r.read / r.total) * 1000) / 10 : 0,
    }));
  }

  statusLabels() {
    return { TXN_STATUS_AR, TASK_STATUS_AR };
  }
}
