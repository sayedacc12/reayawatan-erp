import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, periodFilters, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { ACTIVITY_TYPES, LEAD_STATUS, PARTY_KINDS, PARTY_ROLES } from './entities/crm.entity';
import { CrmCore, audienceLabel, leadCode, partyCode } from './crm-core.service';
import { CRM_PERMISSIONS as P } from './crm.manifest';
import { PartiesService } from './parties.service';

const labels = (list: { key: string; label: string }[]) => Object.fromEntries(list.map((i) => [i.key, i.label])) as Record<string, string>;

/** تقارير علاقات العملاء في البنية الموحدة (PDF وExcel والطباعة) */
@Injectable()
export class CrmReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource, private readonly core: CrmCore, private readonly parties: PartiesService) {}

  onModuleInit() {
    const base = { module: 'crm', permission: P.reports };
    const ownerFilter = dynamicFilter('owner', 'المسؤول', async (u) =>
      (await this.core.users(u.organizationId)).map((x) => ({ value: x.id, label: x.fullName })));
    const sourceFilter = dynamicFilter('source', 'المصدر', async (u) =>
      (await this.core.settings(u.organizationId)).sources.map((x) => ({ value: x.key, label: x.label })));
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'crm.parties', category: 'الجهات', title: 'سجل الجهات الموحد', description: 'كل الجهات بأدوارها في الأنظمة (عميل، عضو، متطوع، شريك) والمسؤول عنها وموافقاتها التسويقية',
        filters: [selectFilter('role', 'الدور', PARTY_ROLES), selectFilter('kind', 'النوع', PARTY_KINDS), ownerFilter], link: '/crm/parties/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'name', label: 'الجهة' }, { key: 'kind', label: 'النوع' }, { key: 'roles', label: 'الأدوار' }, { key: 'phone', label: 'الجوال' },
          { key: 'email', label: 'البريد' }, { key: 'city', label: 'المدينة' }, { key: 'owner', label: 'المسؤول' }, { key: 'consent', label: 'موافقات التواصل' },
          { key: 'activities', label: 'الأنشطة', type: 'number', total: true }, { key: 'lastActivity', label: 'آخر نشاط', type: 'date' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          // نطاق الرؤية نفسه في الشاشات: لا تظهر بيانات عميل أو عضو أو متطوع لمن لا يراها في نظامها
          const sc = await this.parties.scope(org(u));
          const rows = await this.db.query(
            `SELECT p.id, p.party_no, p.name, p.kind, p.phone, p.email, p.city, us.full_name AS owner, p.consents, p.do_not_contact,
                    (SELECT string_agg(DISTINCT l.role, ',') FROM crm_party_links l WHERE l.organization_id = $1 AND l.party_id = p.id) AS roles,
                    (SELECT count(*)::int FROM crm_activities a WHERE a.organization_id = $1 AND (a.party_id = p.id OR a.id IN (SELECT ap.activity_id FROM crm_activity_parties ap WHERE ap.organization_id = a.organization_id AND ap.party_id = p.id))) AS activities,
                    (SELECT max(COALESCE(a.done_at, a.created_at)) FROM crm_activities a WHERE a.organization_id = $1 AND (a.party_id = p.id OR a.id IN (SELECT ap.activity_id FROM crm_activity_parties ap WHERE ap.organization_id = a.organization_id AND ap.party_id = p.id))) AS "lastActivity"
               FROM crm_parties p LEFT JOIN users us ON us.id = p.owner_id AND us.organization_id = $1
              WHERE p.organization_id = $1 AND p.is_active AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM crm_party_links l WHERE l.organization_id = $1 AND l.party_id = p.id AND l.role = $2))
                AND ($3::text IS NULL OR p.kind = $3) AND ($4::uuid IS NULL OR p.owner_id = $4)
                AND crm_party_visible($1, p.id, p.owner_id, $5, $6, $7, $8::text[])
              ORDER BY p.name`, [o, f.role ?? null, f.kind ?? null, f.owner ?? null, org(u).id, sc.all, sc.shared, sc.roles]);
          return rows.map((r: Record<string, unknown>) => ({
            ...r, code: partyCode(Number(r.party_no)), kind: ar(PARTY_KINDS, r.kind),
            roles: String(r.roles ?? '').split(',').filter(Boolean).map((x) => PARTY_ROLES[x as keyof typeof PARTY_ROLES] ?? x).join('، ') || '—',
            consent: r.do_not_contact ? 'لا تتواصل' : Object.entries((r.consents ?? {}) as Record<string, { granted: boolean }>).filter(([, c]) => c.granted).map(([k]) => ({ email: 'بريد', whatsapp: 'واتساب', sms: 'رسائل' })[k] ?? k).join('، ') || '—',
          }));
        },
      },
      {
        ...base, code: 'crm.leads', category: 'العملاء المحتملون', title: 'سجل العملاء المحتملين', description: 'العملاء المحتملون بمصادرهم واهتماماتهم وحالاتهم والمسؤولين عنهم ووقت التواصل الأول',
        filters: [...periodFilters('الإضافة'), selectFilter('status', 'الحالة', LEAD_STATUS), sourceFilter, ownerFilter], link: '/crm/leads/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'createdAt', label: 'تاريخ الإضافة', type: 'date' }, { key: 'name', label: 'الاسم' }, { key: 'company', label: 'المنشأة' },
          { key: 'source', label: 'المصدر' }, { key: 'interest', label: 'الاهتمام' }, { key: 'owner', label: 'المسؤول' }, { key: 'status', label: 'الحالة' },
          { key: 'hours', label: 'ساعات حتى أول تواصل', type: 'number' }, { key: 'onTime', label: 'ضمن المهلة', type: 'bool' }, { key: 'reason', label: 'سبب عدم التأهيل' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const s = await this.core.settings(o);
          const rows = await this.db.query(
            `SELECT l.id, l.lead_no, l.created_at AS "createdAt", l.name, l.company, l.source, l.interest, us.full_name AS owner, l.status, l.disqualify_reason,
                    round((EXTRACT(EPOCH FROM (l.first_contact_at - l.created_at)) / 3600)::numeric, 1)::float AS hours,
                    CASE WHEN l.first_contact_at IS NULL THEN (CASE WHEN l.due_at < now() THEN false ELSE NULL END) ELSE l.first_contact_at <= l.due_at END AS "onTime"
               FROM crm_leads l LEFT JOIN users us ON us.id = l.owner_id AND us.organization_id = $1
              WHERE l.organization_id = $1 AND (l.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2::date AND $3::date
                AND ($4::text IS NULL OR l.status = $4) AND ($5::text IS NULL OR l.source = $5) AND ($6::uuid IS NULL OR l.owner_id = $6)
              ORDER BY l.created_at DESC`, [o, f.from, f.to, f.status ?? null, f.source ?? null, f.owner ?? null]);
          return rows.map((r: Record<string, unknown>) => ({
            ...r, code: leadCode(Number(r.lead_no)), source: ar(labels(s.sources), r.source), interest: ar(labels(s.interests), r.interest),
            status: ar(LEAD_STATUS, r.status), reason: ar(labels(s.disqualifyReasons), r.disqualify_reason),
          }));
        },
      },
      {
        ...base, code: 'crm.sources', category: 'العملاء المحتملون', title: 'المصادر ونسب التحويل', description: 'عدد العملاء المحتملين من كل مصدر، وكم تحول منهم إلى جهات، وكم استُبعد، ونسبة التحويل',
        filters: periodFilters('الإضافة'),
        columns: [
          { key: 'source', label: 'المصدر' }, { key: 'total', label: 'العدد', type: 'number', total: true }, { key: 'open', label: 'مفتوح', type: 'number', total: true },
          { key: 'converted', label: 'تحول إلى جهة', type: 'number', total: true }, { key: 'lost', label: 'غير مؤهل', type: 'number', total: true }, { key: 'rate', label: 'نسبة التحويل', type: 'percent' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const s = await this.core.settings(o);
          const rows: { source: string; total: number; open: number; converted: number; lost: number }[] = await this.db.query(
            `SELECT source, count(*)::int AS total, count(*) FILTER (WHERE status IN ('new', 'contacted', 'qualified'))::int AS open,
                    count(*) FILTER (WHERE status = 'converted')::int AS converted, count(*) FILTER (WHERE status = 'disqualified')::int AS lost
               FROM crm_leads WHERE organization_id = $1 AND (created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2::date AND $3::date
              GROUP BY source ORDER BY total DESC`, [o, f.from, f.to]);
          return rows.map((r) => ({ ...r, source: ar(labels(s.sources), r.source), rate: r.converted + r.lost ? Math.round((r.converted / (r.converted + r.lost)) * 1000) / 10 : null }));
        },
      },
      {
        ...base, code: 'crm.team', category: 'الأداء', title: 'أداء الفريق والاستجابة', description: 'لكل موظف: العملاء المحتملون المسندون، ومتوسط ساعات التواصل الأول، والالتزام بالمهلة، والتحويل، والأنشطة المنجزة والمتأخرة',
        filters: periodFilters(),
        columns: [
          { key: 'name', label: 'الموظف' }, { key: 'leads', label: 'عملاء محتملون', type: 'number', total: true }, { key: 'avgHours', label: 'متوسط ساعات أول تواصل', type: 'number' },
          { key: 'onTime', label: 'ضمن المهلة', type: 'percent' }, { key: 'overdue', label: 'تجاوزوا المهلة دون تواصل', type: 'number', total: true },
          { key: 'converted', label: 'تحولوا إلى جهات', type: 'number', total: true }, { key: 'done', label: 'أنشطة منجزة', type: 'number', total: true }, { key: 'late', label: 'أنشطة متأخرة الآن', type: 'number', total: true },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const rows = await this.db.query(
            `SELECT us.id, us.full_name AS name,
                    (SELECT count(*)::int FROM crm_leads l WHERE l.organization_id = $1 AND l.owner_id = us.id AND (l.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2::date AND $3::date) AS leads,
                    (SELECT round(avg(EXTRACT(EPOCH FROM (l.first_contact_at - l.created_at)) / 3600)::numeric, 1)::float FROM crm_leads l WHERE l.organization_id = $1 AND l.owner_id = us.id AND l.first_contact_at IS NOT NULL AND (l.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2::date AND $3::date) AS "avgHours",
                    (SELECT round(100.0 * count(*) FILTER (WHERE l.first_contact_at <= l.due_at) / NULLIF(count(*), 0), 1)::float FROM crm_leads l WHERE l.organization_id = $1 AND l.owner_id = us.id AND l.first_contact_at IS NOT NULL AND (l.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2::date AND $3::date) AS "onTime",
                    (SELECT count(*)::int FROM crm_leads l WHERE l.organization_id = $1 AND l.owner_id = us.id AND l.status IN ('new', 'contacted', 'qualified') AND l.first_contact_at IS NULL AND l.due_at < now()) AS overdue,
                    (SELECT count(*)::int FROM crm_leads l WHERE l.organization_id = $1 AND l.owner_id = us.id AND l.status = 'converted' AND (l.converted_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2::date AND $3::date) AS converted,
                    (SELECT count(*)::int FROM crm_activities a WHERE a.organization_id = $1 AND a.owner_id = us.id AND (a.done_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2::date AND $3::date) AS done,
                    (SELECT count(*)::int FROM crm_activities a WHERE a.organization_id = $1 AND a.owner_id = us.id AND a.done_at IS NULL AND a.due_at < now()) AS late
               FROM users us WHERE us.organization_id = $1 AND us.is_active
                AND (EXISTS (SELECT 1 FROM crm_leads l WHERE l.organization_id = $1 AND l.owner_id = us.id) OR EXISTS (SELECT 1 FROM crm_activities a WHERE a.organization_id = $1 AND a.owner_id = us.id))
              ORDER BY us.full_name`, [o, f.from, f.to]);
          return rows;
        },
      },
      {
        ...base, code: 'crm.activities', category: 'الأداء', title: 'سجل الأنشطة والمتابعات', description: 'المكالمات والزيارات والرسائل والمهام بمواعيدها ونتائجها',
        filters: [...periodFilters(), selectFilter('type', 'النوع', ACTIVITY_TYPES), selectFilter('state', 'الحالة', { done: 'منجز', open: 'مجدول', overdue: 'متأخر' }), ownerFilter], orientation: 'landscape',
        columns: [
          { key: 'date', label: 'التاريخ', type: 'datetime' }, { key: 'type', label: 'النوع' }, { key: 'subject', label: 'العنوان' }, { key: 'related', label: 'الجهة أو العميل المحتمل' },
          { key: 'owner', label: 'المسؤول' }, { key: 'state', label: 'الحالة' }, { key: 'outcome', label: 'النتيجة' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const rows = await this.db.query(
            `SELECT COALESCE(a.done_at, a.due_at, a.created_at) AS date, a.type, a.subject, COALESCE(p.name, l.name) AS related, us.full_name AS owner, a.outcome,
                    a.audience, a.audience_role, CASE WHEN a.audience IS NOT NULL THEN (SELECT count(*)::int FROM crm_activity_parties ap WHERE ap.organization_id = $1 AND ap.activity_id = a.id) END AS party_count,
                    CASE WHEN a.done_at IS NOT NULL THEN 'منجز' WHEN a.due_at < now() THEN 'متأخر' ELSE 'مجدول' END AS state
               FROM crm_activities a LEFT JOIN crm_parties p ON p.id = a.party_id AND p.organization_id = $1 LEFT JOIN crm_leads l ON l.id = a.lead_id AND l.organization_id = $1
               LEFT JOIN users us ON us.id = a.owner_id AND us.organization_id = $1
              WHERE a.organization_id = $1 AND (COALESCE(a.done_at, a.due_at, a.created_at) AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2::date AND $3::date
                AND ($4::text IS NULL OR a.type = $4) AND ($5::uuid IS NULL OR a.owner_id = $5)
                AND ($6::text IS NULL OR ($6 = 'done' AND a.done_at IS NOT NULL) OR ($6 = 'open' AND a.done_at IS NULL AND (a.due_at IS NULL OR a.due_at >= now())) OR ($6 = 'overdue' AND a.done_at IS NULL AND a.due_at < now()))
              ORDER BY 1 DESC`, [o, f.from, f.to, f.type ?? null, f.owner ?? null, f.state ?? null]);
          return rows.map((r: Record<string, unknown>) => ({
            ...r, type: ar(ACTIVITY_TYPES, r.type), related: r.related ?? audienceLabel(r.audience as string | null, r.audience_role as string | null, r.party_count as number | null),
          }));
        },
      },
    ];
    this.registry.register(defs);
  }
}
