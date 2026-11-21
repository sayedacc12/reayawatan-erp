import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition, ReportRow } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { CONTRACT_STATUS, EVAL_STATUS, FOLLOWUP_KINDS, PARTNER_STATUS, PtSettings } from './entities/partnerships.entity';
import { PARTNERSHIP_PERMISSIONS as P } from './partnerships.manifest';
import { partnerCode, ptToday } from './partnerships.service';

/** تقارير نظام الشراكات في البنية الموحدة (PDF وExcel والطباعة) */
@Injectable()
export class PartnershipsReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource) {}

  private async tiers(orgId: string) {
    const s = await this.db.getRepository(PtSettings).findOne({ where: { organizationId: orgId } });
    return Object.fromEntries((s?.tiers ?? []).map((t) => [t.key, t.label])) as Record<string, string>;
  }

  onModuleInit() {
    const base = { module: 'partnerships', permission: P.reports };
    const typeFilter = dynamicFilter('type', 'نوع الشراكة', async (u) =>
      (await this.db.query('SELECT id AS value, name AS label FROM pt_types WHERE organization_id = $1 ORDER BY sort_order', [u.organizationId])));
    const contractStates = { open: 'تحت الإجراء', signed: 'ساري', expired: 'منتهي', terminated: 'منهى', cancelled: 'ملغى' };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'partnerships.register', category: 'الشركاء', title: 'سجل الشركاء', description: 'كل الشركاء بتصنيفاتهم وأنواع الشراكة ومستوياتهم ودرجات تقييمهم',
        filters: [selectFilter('status', 'الحالة', PARTNER_STATUS), typeFilter], link: '/partnerships/partners/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'name', label: 'الشريك' }, { key: 'cls', label: 'التصنيف' }, { key: 'types', label: 'أنواع الشراكة' },
          { key: 'city', label: 'المدينة' }, { key: 'contact', label: 'جهة التواصل' }, { key: 'status', label: 'الحالة' }, { key: 'tier', label: 'المستوى' },
          { key: 'score', label: 'الدرجة', type: 'number' }, { key: 'contracts', label: 'عقود سارية', type: 'number', total: true }, { key: 'nextEval', label: 'إعادة التقييم', type: 'date' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const tiers = await this.tiers(o);
          const rows = await this.db.query(
            `SELECT p.id, p.partner_no, p.name, c.name AS cls, p.city, p.contact_name AS contact, p.status, p.tier, p.score::float AS score, p.next_evaluation_on::text AS "nextEval",
                    (SELECT string_agg(t.name, '، ' ORDER BY t.sort_order) FROM pt_types t WHERE p.type_ids ? t.id::text) AS types,
                    (SELECT count(*)::int FROM pt_contracts k WHERE k.partner_id = p.id AND k.status = 'signed' AND k.ends_on >= $4) AS contracts
               FROM pt_partners p LEFT JOIN pt_classes c ON c.id = p.class_id
              WHERE p.organization_id = $1 AND ($2::text IS NULL OR p.status = $2) AND ($3::text IS NULL OR p.type_ids ? $3)
              ORDER BY p.score DESC NULLS LAST, p.name`, [o, f.status ?? null, f.type ?? null, ptToday()]);
          return rows.map((r: Record<string, unknown>) => ({ ...r, code: partnerCode(Number(r.partner_no)), status: ar(PARTNER_STATUS, r.status), tier: ar(tiers, r.tier) }));
        },
      },
      {
        ...base, code: 'partnerships.evaluations', category: 'الشركاء', title: 'تقييمات اختيار الشركاء', description: 'التقييمات بدرجاتها وحدودها الدنيا وقراراتها، مع تمييز ما اعتُمد رغم مخالفة القواعد',
        filters: [selectFilter('status', 'حالة التقييم', EVAL_STATUS), typeFilter], link: '/partnerships/partners/{partnerId}', orientation: 'landscape',
        columns: [
          { key: 'partner', label: 'الشريك' }, { key: 'type', label: 'نوع الشراكة' }, { key: 'total', label: 'الدرجة', type: 'number' }, { key: 'minScore', label: 'الحد الأدنى', type: 'number' },
          { key: 'knockout', label: 'معيار حاسم غير مجتاز', type: 'bool' }, { key: 'tier', label: 'المستوى' }, { key: 'status', label: 'الحالة' }, { key: 'overridden', label: 'اعتماد استثنائي', type: 'bool' },
          { key: 'evaluator', label: 'المقيّم' }, { key: 'decidedBy', label: 'المعتمد' }, { key: 'decidedAt', label: 'تاريخ القرار', type: 'date' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const tiers = await this.tiers(o);
          const rows = await this.db.query(
            `SELECT e.partner_id AS "partnerId", p.name AS partner, t.name AS type, e.total::float AS total, e.min_score AS "minScore", e.knockout_failed AS knockout, e.tier, e.status,
                    e.overridden, e.evaluator_name AS evaluator, e.decided_by_name AS "decidedBy", e.decided_at AS "decidedAt"
               FROM pt_evaluations e JOIN pt_partners p ON p.id = e.partner_id LEFT JOIN pt_types t ON t.id = e.type_id
              WHERE e.organization_id = $1 AND ($2::text IS NULL OR e.status = $2) AND ($3::uuid IS NULL OR e.type_id = $3::uuid)
              ORDER BY e.created_at DESC`, [o, f.status ?? null, f.type ?? null]);
          return rows.map((r: Record<string, unknown>) => ({ ...r, tier: ar(tiers, r.tier), status: ar(EVAL_STATUS, r.status), _style: r.overridden ? 'strong' : undefined }) as ReportRow);
        },
      },
      {
        ...base, code: 'partnerships.contracts', category: 'العقود', title: 'سجل عقود الشراكة', description: 'العقود بأطرافها وأنواعها ومددها وقيمها وحالاتها وإصداراتها',
        filters: [selectFilter('state', 'الحالة', contractStates), typeFilter], link: '/partnerships/contracts/{id}', orientation: 'landscape',
        columns: [
          { key: 'number', label: 'رقم العقد' }, { key: 'title', label: 'العنوان' }, { key: 'partner', label: 'الشريك' }, { key: 'type', label: 'النوع' },
          { key: 'project', label: 'المشروع' }, { key: 'startsOn', label: 'البداية', type: 'date' }, { key: 'endsOn', label: 'النهاية', type: 'date' },
          { key: 'value', label: 'القيمة', type: 'money', total: true }, { key: 'version', label: 'الإصدار', type: 'number' }, { key: 'status', label: 'الحالة' }, { key: 'signer', label: 'موقّع الشريك' },
        ],
        run: async (u, f) => {
          const t = ptToday();
          const rows = await this.db.query(
            `SELECT c.id, c.number, c.title, p.name AS partner, ty.name AS type, a.name AS project, c.starts_on::text AS "startsOn", c.ends_on::text AS "endsOn",
                    c.value::float AS value, c.version, CASE WHEN c.status = 'signed' AND c.ends_on < $2 THEN 'expired' ELSE c.status END AS status, c.signer_name AS signer
               FROM pt_contracts c JOIN pt_partners p ON p.id = c.partner_id LEFT JOIN pt_types ty ON ty.id = c.type_id LEFT JOIN activities a ON a.id = c.project_id
              WHERE c.organization_id = $1 AND ($3::uuid IS NULL OR c.type_id = $3::uuid)
              ORDER BY c.number DESC`, [org(u).organizationId, t, f.type ?? null]);
          const open = ['draft', 'review', 'approved', 'sent', 'changes_requested'];
          return rows.filter((r: { status: string }) => !f.state || (f.state === 'open' ? open.includes(r.status) : r.status === f.state))
            .map((r: Record<string, unknown>) => ({ ...r, status: ar(CONTRACT_STATUS, r.status) }));
        },
      },
      {
        ...base, code: 'partnerships.expiring', category: 'العقود', title: 'العقود القريبة من الانتهاء', description: 'العقود السارية التي تنتهي خلال مدة التنبيه المحددة في الإعدادات، والمنتهية دون تجديد',
        filters: [], link: '/partnerships/contracts/{id}',
        columns: [
          { key: 'number', label: 'رقم العقد' }, { key: 'title', label: 'العنوان' }, { key: 'partner', label: 'الشريك' }, { key: 'endsOn', label: 'تاريخ النهاية', type: 'date' },
          { key: 'days', label: 'الأيام المتبقية', type: 'number' }, { key: 'renewal', label: 'التجديد' },
        ],
        run: async (u) => {
          const o = org(u).organizationId;
          const s = await this.db.getRepository(PtSettings).findOne({ where: { organizationId: o } });
          const rows = await this.db.query(
            `SELECT c.id, c.number, c.title, p.name AS partner, c.ends_on::text AS "endsOn", (c.ends_on - $2::date)::int AS days,
                    (SELECT r.number FROM pt_contracts r WHERE r.renewal_of = c.id AND r.status <> 'cancelled' LIMIT 1) AS renewal
               FROM pt_contracts c JOIN pt_partners p ON p.id = c.partner_id
              WHERE c.organization_id = $1 AND c.status = 'signed' AND c.ends_on <= $2::date + $3::int AND c.ends_on >= $2::date - 90
              ORDER BY c.ends_on`, [o, ptToday(), s?.alertDays ?? 60]);
          return rows.map((r: { days: number; renewal: string | null }) => ({ ...r, renewal: r.renewal ?? 'لم يبدأ', _style: r.days < 0 ? 'strong' : undefined }) as ReportRow);
        },
      },
      {
        ...base, code: 'partnerships.followups', category: 'العقود', title: 'متابعة التزامات العقود', description: 'الالتزامات والمواعيد على عقود الشراكة: المنجز والمفتوح والمتأخر',
        filters: [selectFilter('state', 'الحالة', { open: 'مفتوحة', overdue: 'متأخرة', done: 'منجزة' }), selectFilter('kind', 'النوع', FOLLOWUP_KINDS)], link: '/partnerships/contracts/{contractId}',
        orientation: 'landscape',
        columns: [
          { key: 'number', label: 'العقد' }, { key: 'partner', label: 'الشريك' }, { key: 'title', label: 'الالتزام' }, { key: 'kind', label: 'النوع' }, { key: 'party', label: 'المسؤول عنه' },
          { key: 'responsible', label: 'المكلف' }, { key: 'dueDate', label: 'الاستحقاق', type: 'date' }, { key: 'doneAt', label: 'الإنجاز', type: 'date' }, { key: 'state', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const t = ptToday();
          const rows = await this.db.query(
            `SELECT f.contract_id AS "contractId", c.number, p.name AS partner, f.title, f.kind, f.party, f.responsible, f.due_date::text AS "dueDate", f.done_at::text AS "doneAt"
               FROM pt_followups f JOIN pt_contracts c ON c.id = f.contract_id JOIN pt_partners p ON p.id = c.partner_id
              WHERE f.organization_id = $1 AND ($2::text IS NULL OR f.kind = $2) ORDER BY f.due_date`, [org(u).organizationId, f.kind ?? null]);
          return rows.map((r: Record<string, string | null>) => {
            const state = r.doneAt ? 'done' : r.dueDate! < t ? 'overdue' : 'open';
            return { ...r, kind: ar(FOLLOWUP_KINDS, r.kind), party: r.party === 'partner' ? 'الشريك' : 'الشركة', state, _style: state === 'overdue' ? 'strong' : undefined } as ReportRow;
          }).filter((r: ReportRow) => !f.state || r.state === f.state).map((r: ReportRow) => ({ ...r, state: ({ done: 'منجزة', overdue: 'متأخرة', open: 'مفتوحة' } as Record<string, string>)[String(r.state)] }));
        },
      },
      {
        ...base, code: 'partnerships.by_type', category: 'الإحصاءات', title: 'الشراكات حسب النوع والتصنيف', description: 'عدد الشركاء المعتمدين والعقود السارية وقيمها لكل نوع شراكة، ثم لكل تصنيف شريك',
        filters: [],
        columns: [
          { key: 'name', label: 'البند' }, { key: 'partners', label: 'شركاء معتمدون', type: 'number' }, { key: 'contracts', label: 'عقود سارية', type: 'number' },
          { key: 'value', label: 'قيمة العقود السارية', type: 'money' }, { key: 'avg', label: 'متوسط الدرجة', type: 'number' },
        ],
        run: async (u) => {
          const o = org(u).organizationId;
          const t = ptToday();
          const types = await this.db.query(
            `SELECT ty.name, (SELECT count(*)::int FROM pt_partners p WHERE p.organization_id = $1 AND p.status = 'approved' AND p.type_ids ? ty.id::text) AS partners,
                    count(c.id)::int AS contracts, coalesce(sum(c.value), 0)::float AS value,
                    (SELECT round(avg(p.score), 1)::float FROM pt_partners p WHERE p.organization_id = $1 AND p.status = 'approved' AND p.type_ids ? ty.id::text) AS avg
               FROM pt_types ty LEFT JOIN pt_contracts c ON c.type_id = ty.id AND c.status = 'signed' AND c.ends_on >= $2
              WHERE ty.organization_id = $1 GROUP BY ty.id ORDER BY ty.sort_order`, [o, t]);
          const classes = await this.db.query(
            `SELECT cl.name, count(DISTINCT p.id) FILTER (WHERE p.status = 'approved')::int AS partners, count(c.id)::int AS contracts, coalesce(sum(c.value), 0)::float AS value,
                    round(avg(p.score) FILTER (WHERE p.status = 'approved'), 1)::float AS avg
               FROM pt_classes cl LEFT JOIN pt_partners p ON p.class_id = cl.id LEFT JOIN pt_contracts c ON c.partner_id = p.id AND c.status = 'signed' AND c.ends_on >= $2
              WHERE cl.organization_id = $1 GROUP BY cl.id ORDER BY cl.sort_order`, [o, t]);
          const rows: ReportRow[] = [{ name: 'حسب نوع الشراكة', _style: 'group', _skipTotal: true }, ...types,
            { name: 'حسب تصنيف الشريك', _style: 'group', _skipTotal: true }, ...classes];
          return { rows, notes: ['الشريك قد يكون معتمدًا في أكثر من نوع شراكة، فيُحسب في كل نوع منها.'] };
        },
      },
    ];
    this.registry.register(defs);
  }
}
