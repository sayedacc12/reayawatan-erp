import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, periodFilters, r2, selectFilter, within } from '../reports/report-helpers';
import { ReportDefinition } from '../reports/report.types';
import { ReportsRegistry } from '../reports/reports.registry';
import { SupportDeskService } from './support-desk.service';
import { SUPPORT_PERMISSIONS as P } from './support.manifest';
import { SupportService } from './support.service';

const PRIORITY: Record<string, string> = { very_critical: 'حرج جدًا', critical: 'حرج', medium: 'متوسط', normal: 'عادي', low: 'منخفض' };
const CATEGORY: Record<string, string> = {
  malfunction: 'عطل أو خطأ في النظام', access: 'مشكلة دخول أو صلاحيات', data: 'تصحيح بيانات', question: 'استفسار عن الاستخدام', feature: 'طلب تطوير أو ميزة', other: 'أخرى',
};
const STATUS: Record<string, string> = { new: 'جديد', in_progress: 'قيد المعالجة', waiting_customer: 'بانتظار رد الشركة', resolved: 'تم الحل', closed: 'مغلق' };
const SLA: Record<string, string> = { met: 'ضمن المهلة', on_track: 'ضمن المهلة', at_risk: 'قاربت على الانتهاء', breached: 'تجاوز المهلة', paused: 'متوقفة' };
const TASK: Record<string, string> = { todo: 'لم تبدأ', in_progress: 'جارية', done: 'منجزة', cancelled: 'ملغاة' };
const ROLE: Record<string, string> = { owner: 'مدير المنصة', support_manager: 'مدير الدعم', support_agent: 'موظف الدعم' };
const hoursBetween = (a?: Date | string | null, b?: Date | string | null) => (a && b ? r2((+new Date(b) - +new Date(a)) / 3_600_000) : null);

/** تقارير الدعم الفني (فريق المنصة): طلبات الصيانة والالتزام بمستويات الخدمة، أداء الفريق، والمهام */
@Injectable()
export class SupportReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly support: SupportService, private readonly desk: SupportDeskService, private readonly db: DataSource) {}

  onModuleInit() {
    const base = { module: 'support', permission: P.reports, scope: 'platform' as const };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'support.tickets', category: 'طلبات الصيانة', title: 'سجل طلبات الصيانة', description: 'الطلبات في الفترة بمستوى الخدمة والمسؤول ومدة الاستجابة والحل والالتزام بالمهلة',
        orientation: 'landscape', link: '/support-desk/tickets/{id}',
        filters: [
          ...periodFilters('الطلب'), selectFilter('status', 'الحالة', STATUS), selectFilter('priority', 'المستوى', PRIORITY),
          dynamicFilter('organizationId', 'الشركة', async () => (await this.db.query('SELECT id AS value, name AS label FROM organizations ORDER BY name')) as { value: string; label: string }[]),
        ],
        columns: [
          { key: 'number', label: 'الرقم' }, { key: 'createdAt', label: 'التاريخ', type: 'datetime' }, { key: 'organization', label: 'الشركة' }, { key: 'subject', label: 'الموضوع' },
          { key: 'category', label: 'التصنيف' }, { key: 'priority', label: 'المستوى' }, { key: 'status', label: 'الحالة' }, { key: 'assignee', label: 'المسؤول' },
          { key: 'responseHours', label: 'أول رد (ساعة)', type: 'number' }, { key: 'response', label: 'مهلة الرد' },
          { key: 'resolutionHours', label: 'الحل (ساعة)', type: 'number' }, { key: 'resolution', label: 'مهلة الحل' }, { key: 'rating', label: 'التقييم', type: 'number' },
        ],
        run: async (_u, f) => {
          const list = (await this.support.platformList({ status: f.status, priority: f.priority, organizationId: f.organizationId }))
            .filter((t) => within(t.createdAt, f.from, f.to))
            .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
          const done = list.filter((t) => t.sla.resolution === 'met' || t.sla.resolution === 'breached');
          const responded = list.filter((t) => t.sla.response === 'met' || t.sla.response === 'breached');
          return {
            rows: list.map((t) => ({
              id: t.id, number: t.number, createdAt: t.createdAt, organization: t.organization?.name ?? null, subject: t.subject, category: ar(CATEGORY, t.category),
              priority: ar(PRIORITY, t.priority), status: ar(STATUS, t.status), assignee: t.assigneeName, responseHours: hoursBetween(t.createdAt, t.firstResponseAt),
              response: ar(SLA, t.sla.response), resolutionHours: hoursBetween(t.createdAt, t.resolvedAt), resolution: ar(SLA, t.sla.resolution), rating: t.rating,
              _style: t.sla.response === 'breached' || t.sla.resolution === 'breached' ? 'strong' as const : undefined,
            })),
            summary: [
              { label: 'إجمالي الطلبات', value: list.length, type: 'number' },
              { label: 'الالتزام بمهلة الرد', value: responded.length ? r2((responded.filter((t) => t.sla.response === 'met').length / responded.length) * 100) : null, type: 'percent' },
              { label: 'الالتزام بمهلة الحل', value: done.length ? r2((done.filter((t) => t.sla.resolution === 'met').length / done.length) * 100) : null, type: 'percent' },
              { label: 'مفتوحة الآن', value: list.filter((t) => ['new', 'in_progress', 'waiting_customer'].includes(t.status)).length, type: 'number' },
            ],
          };
        },
      },
      {
        ...base, code: 'support.by-organization', category: 'طلبات الصيانة', title: 'الطلبات حسب الشركة', description: 'عدد طلبات كل جمعية ومستوياتها ومتوسط تقييمها في الفترة',
        filters: periodFilters('الطلب'),
        columns: [
          { key: 'organization', label: 'الشركة' }, { key: 'total', label: 'الطلبات', type: 'number', total: true }, { key: 'critical', label: 'حرجة', type: 'number', total: true },
          { key: 'open', label: 'مفتوحة', type: 'number', total: true }, { key: 'resolved', label: 'محلولة', type: 'number', total: true },
          { key: 'avgResolution', label: 'متوسط الحل (ساعة)', type: 'number' }, { key: 'rating', label: 'متوسط التقييم', type: 'number' },
        ],
        run: async (_u, f) => this.db.query(
          `SELECT COALESCE(o.name, '—') AS organization, COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE t.priority IN ('very_critical', 'critical'))::int AS critical,
                  COUNT(*) FILTER (WHERE t.status IN ('new', 'in_progress', 'waiting_customer'))::int AS open,
                  COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL)::int AS resolved,
                  ROUND(AVG(EXTRACT(EPOCH FROM t.resolved_at - t.created_at) / 3600)::numeric, 1)::float AS "avgResolution",
                  ROUND(AVG(t.rating)::numeric, 1)::float AS rating
             FROM support_tickets t LEFT JOIN organizations o ON o.id = t.organization_id
            WHERE (t.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1 AND $2 GROUP BY o.name ORDER BY total DESC`, [f.from, f.to]),
      },
      {
        ...base, code: 'support.performance', category: 'الفريق', title: 'تقييم أداء فريق الدعم', description: 'الالتزام بمهل الرد والحل وإنجاز المهام في موعدها وتقييم الجمعيات، والدرجة من 100',
        filters: [{ key: 'from', label: 'من تاريخ', type: 'date', default: 'monthStart', required: true }, { key: 'to', label: 'إلى تاريخ', type: 'date', default: 'today', required: true }],
        orientation: 'landscape',
        columns: [
          { key: 'fullName', label: 'العضو' }, { key: 'role', label: 'الدور' }, { key: 'responses', label: 'ردود', type: 'number', total: true },
          { key: 'responseCompliance', label: 'التزام الرد', type: 'percent' }, { key: 'resolved', label: 'طلبات محلولة', type: 'number', total: true },
          { key: 'resolutionCompliance', label: 'التزام الحل', type: 'percent' }, { key: 'tasksDone', label: 'مهام منجزة', type: 'number', total: true },
          { key: 'taskCompliance', label: 'المهام في موعدها', type: 'percent' }, { key: 'hoursLogged', label: 'ساعات العمل', type: 'number', total: true },
          { key: 'avgRating', label: 'تقييم الجمعيات', type: 'number' }, { key: 'score', label: 'الدرجة', type: 'number' }, { key: 'grade', label: 'التقدير' },
        ],
        run: async (_u, f) => (await this.desk.performance(f.from, f.to)).members.map((m) => ({ ...m, role: ar(ROLE, m.role) })),
      },
      {
        ...base, code: 'support.tasks', category: 'الفريق', title: 'المهام والتكليفات', description: 'مهام فريق الدعم بالمكلّف وموعد التسليم والساعات المقدرة والفعلية',
        filters: [...periodFilters('الإنشاء'), selectFilter('status', 'الحالة', TASK)], link: '/support-desk/tasks/{id}', orientation: 'landscape',
        columns: [
          { key: 'number', label: 'الرقم' }, { key: 'title', label: 'المهمة' }, { key: 'ticket', label: 'الطلب المرتبط' }, { key: 'priority', label: 'الأولوية' },
          { key: 'assignee', label: 'المكلّف' }, { key: 'status', label: 'الحالة' }, { key: 'dueAt', label: 'موعد التسليم', type: 'datetime' },
          { key: 'completedAt', label: 'تاريخ الإنجاز', type: 'datetime' }, { key: 'estimated', label: 'الساعات المقدرة', type: 'number', total: true },
          { key: 'spent', label: 'الساعات الفعلية', type: 'number', total: true }, { key: 'onTime', label: 'في الموعد' },
        ],
        run: async (_u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT k.id, k.number, k.title, t.number AS ticket, k.priority, k.assignee_name, k.status, k.due_at, k.completed_at,
                    k.estimated_hours::float AS estimated, k.spent_hours::float AS spent
               FROM support_tasks k LEFT JOIN support_tickets t ON t.id = k.ticket_id
              WHERE (k.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1 AND $2 AND ($3::text IS NULL OR k.status = $3) ORDER BY k.created_at`,
            [f.from, f.to, f.status ?? null]);
          const now = Date.now();
          return rows.map((r) => ({
            id: r.id, number: r.number, title: r.title, ticket: r.ticket, priority: ar(PRIORITY, r.priority), assignee: r.assignee_name, status: ar(TASK, r.status),
            dueAt: r.due_at, completedAt: r.completed_at, estimated: r.estimated, spent: r.spent,
            onTime: r.status === 'done' ? (+new Date(String(r.completed_at)) <= +new Date(String(r.due_at)) ? 'نعم' : 'متأخرة')
              : r.status === 'cancelled' ? null : +new Date(String(r.due_at)) < now ? 'متأخرة' : null,
          }));
        },
      },
    ];
    this.registry.register(defs);
  }
}
