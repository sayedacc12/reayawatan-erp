import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, org, periodFilters, r2, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { VolReportsService } from './vol-reports.service';
import { VolCore } from './vol-core.service';
import { VOL_PERMISSIONS as P } from './volunteers.manifest';
import { STATUS_LABELS } from './volunteers.service';

const CONTRACT: Record<string, string> = { issued: 'بانتظار التوقيع', signed: 'موقّع', cancelled: 'ملغى' };
const CERT: Record<string, string> = { hours: 'شهادة ساعات', thanks: 'شهادة شكر' };
const GENDER: Record<string, string> = { male: 'ذكر', female: 'أنثى' };

type Datasets = Awaited<ReturnType<VolReportsService['reports']>>;

/** تقارير التطوع في البنية الموحدة: التقارير السابقة نفسها، مع سجل المتطوعين والعقود والشهادات */
@Injectable()
export class VolunteersReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly reports: VolReportsService, private readonly core: VolCore, private readonly db: DataSource) {}

  onModuleInit() {
    const base = { module: 'volunteers', permission: P.reports, filters: periodFilters() };
    const from = <K extends keyof Datasets>(key: K) => async (u: Parameters<ReportDefinition['run']>[0], f: Record<string, string | undefined>) =>
      (await this.reports.reports(org(u), { from: f.from, to: f.to }))[key] as unknown as Record<string, unknown>[];

    const defs: ReportDefinition[] = [
      {
        ...base, code: 'volunteers.hours', category: 'المتطوعون', title: 'ساعات المتطوعين', description: 'الفعاليات والساعات المعتمدة ومتوسط التقييم لكل متطوع في الفترة',
        columns: [
          { key: 'volunteerNo', label: 'رقم المتطوع' }, { key: 'fullName', label: 'المتطوع' }, { key: 'gender', label: 'الجنس' }, { key: 'type', label: 'النوع' },
          { key: 'events', label: 'الفعاليات', type: 'number', total: true }, { key: 'hours', label: 'الساعات', type: 'number', total: true },
          { key: 'rating', label: 'متوسط التقييم', type: 'number' },
        ],
        run: from('volunteerHours'),
      },
      {
        ...base, code: 'volunteers.register', category: 'المتطوعون', title: 'سجل المتطوعين', description: 'بيانات المتطوعين وحالتهم وإجمالي ساعاتهم منذ الانضمام',
        filters: [selectFilter('status', 'الحالة', STATUS_LABELS), selectFilter('gender', 'الجنس', GENDER)], link: '/volunteers/list/{id}', orientation: 'landscape',
        columns: [
          { key: 'volunteerNo', label: 'الرقم' }, { key: 'fullName', label: 'الاسم' }, { key: 'gender', label: 'الجنس' }, { key: 'age', label: 'العمر', type: 'number' },
          { key: 'mobile', label: 'الجوال' }, { key: 'city', label: 'المدينة' }, { key: 'qualification', label: 'المؤهل' }, { key: 'type', label: 'النوع' },
          { key: 'fields', label: 'المجالات' }, { key: 'status', label: 'الحالة' }, { key: 'joinedOn', label: 'تاريخ الانضمام', type: 'date' },
          { key: 'hours', label: 'إجمالي الساعات', type: 'number', total: true },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const s = await this.core.settings(o);
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT v.id, v.volunteer_no, v.full_name, v.gender, v.birth_date::text AS birth_date, v.mobile, v.city, v.qualification, v.type_code, v.field_codes, v.status,
                    v.joined_on::text AS joined_on,
                    COALESCE((SELECT SUM(p.hours) FROM vol_participations p WHERE p.volunteer_id = v.id AND p.status = 'attended'), 0)::float AS hours
               FROM vol_volunteers v WHERE v.organization_id = $1 AND ($2::text IS NULL OR v.status = $2) AND ($3::text IS NULL OR v.gender = $3)
              ORDER BY v.volunteer_no`, [o, f.status ?? null, f.gender ?? null]);
          const year = new Date().getFullYear();
          return rows.map((r) => ({
            id: r.id, volunteerNo: r.volunteer_no, fullName: r.full_name, gender: ar(GENDER, r.gender), age: r.birth_date ? year - Number(String(r.birth_date).slice(0, 4)) : null,
            mobile: r.mobile, city: r.city, qualification: r.qualification, type: this.core.label(s.volunteerTypes, r.type_code as string),
            fields: ((r.field_codes as string[]) ?? []).map((c) => this.core.label(s.volunteerFields, c)).join('، ') || null,
            status: ar(STATUS_LABELS, r.status), joinedOn: r.joined_on, hours: r.hours,
          }));
        },
      },
      {
        ...base, code: 'volunteers.events', category: 'الفعاليات', title: 'الفعاليات وإنجازها', description: 'كل فعالية في الفترة: المستهدف والمحقق من المستفيدين، الحضور والساعات، الميزانية والتكلفة والرضا',
        orientation: 'landscape',
        columns: [
          { key: 'eventNo', label: 'الرقم' }, { key: 'title', label: 'الفعالية' }, { key: 'kind', label: 'النوع' }, { key: 'category', label: 'التصنيف' },
          { key: 'startDate', label: 'البداية', type: 'date' }, { key: 'status', label: 'الحالة' },
          { key: 'targetBeneficiaries', label: 'المستفيدون المستهدفون', type: 'number', total: true }, { key: 'actualBeneficiaries', label: 'المستفيدون فعليًا', type: 'number', total: true },
          { key: 'attended', label: 'المتطوعون الحاضرون', type: 'number', total: true }, { key: 'hours', label: 'الساعات', type: 'number', total: true },
          { key: 'budget', label: 'الميزانية', type: 'money', total: true }, { key: 'actualCost', label: 'التكلفة الفعلية', type: 'money', total: true },
          { key: 'satisfaction', label: 'الرضا', type: 'number' },
        ],
        run: from('events'),
      },
      {
        ...base, code: 'volunteers.fields', category: 'الفعاليات', title: 'المتطوعون والفعاليات حسب المجال', description: 'عدد المتطوعين النشطين والفعاليات في كل مجال تطوعي',
        columns: [{ key: 'name', label: 'المجال' }, { key: 'volunteers', label: 'المتطوعون النشطون', type: 'number' }, { key: 'events', label: 'الفعاليات', type: 'number', total: true }],
        run: from('fields'),
      },
      {
        ...base, code: 'volunteers.satisfaction', category: 'الفعاليات', title: 'رضا المتطوعين والمستفيدين', description: 'عدد ردود الاستبانات ومتوسط الرضا لكل فئة',
        columns: [{ key: 'audience', label: 'الفئة' }, { key: 'n', label: 'عدد الردود', type: 'number', total: true }, { key: 'score', label: 'متوسط الرضا', type: 'number' }],
        run: from('satisfaction'),
      },
      {
        ...base, code: 'volunteers.contracts', category: 'العقود والشهادات', title: 'عقود التطوع', description: 'عقود المتطوعين بتاريخها وحالة توقيعها، والعقود القريبة من الانتهاء',
        filters: [selectFilter('status', 'الحالة', CONTRACT)], link: '/volunteers/contracts/{id}',
        columns: [
          { key: 'contractNo', label: 'رقم العقد' }, { key: 'volunteer', label: 'المتطوع' }, { key: 'startDate', label: 'البداية', type: 'date' },
          { key: 'endDate', label: 'النهاية', type: 'date' }, { key: 'status', label: 'الحالة' }, { key: 'signedVia', label: 'طريقة التوقيع' },
          { key: 'signedAt', label: 'تاريخ التوقيع', type: 'date' }, { key: 'note', label: 'ملاحظة' },
        ],
        run: async (u, f) => {
          const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
          const soon = new Date(Date.now() + 33 * 86_400_000).toISOString().slice(0, 10);
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT c.id, c.contract_no, v.full_name, c.start_date::text AS start_date, c.end_date::text AS end_date, c.status, c.signed_via, c.signed_at
               FROM vol_contracts c JOIN vol_volunteers v ON v.id = c.volunteer_id
              WHERE c.organization_id = $1 AND ($2::text IS NULL OR c.status = $2) ORDER BY c.contract_no DESC`, [org(u).organizationId, f.status ?? null]);
          return rows.map((r) => ({
            id: r.id, contractNo: r.contract_no, volunteer: r.full_name, startDate: r.start_date, endDate: r.end_date, status: ar(CONTRACT, r.status),
            signedVia: r.signed_via === 'paper' ? 'ورقي' : r.signed_via ? 'إلكتروني' : null, signedAt: r.signed_at,
            note: r.status === 'cancelled' ? null : String(r.end_date) < today ? 'منتهٍ' : String(r.end_date) <= soon ? 'ينتهي خلال شهر' : null,
          }));
        },
      },
      {
        ...base, code: 'volunteers.certificates', category: 'العقود والشهادات', title: 'سجل الشهادات', description: 'شهادات الساعات والشكر الصادرة في الفترة برموز التحقق',
        filters: [...periodFilters('الإصدار'), selectFilter('kind', 'النوع', CERT)], link: '/volunteers/certificates/{id}',
        columns: [
          { key: 'certificateNo', label: 'رقم الشهادة' }, { key: 'issuedOn', label: 'تاريخ الإصدار', type: 'date' }, { key: 'volunteer', label: 'المتطوع' },
          { key: 'kind', label: 'النوع' }, { key: 'event', label: 'الفعالية' }, { key: 'hours', label: 'الساعات', type: 'number', total: true },
          { key: 'verifyCode', label: 'رمز التحقق' }, { key: 'state', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT c.id, c.certificate_no, c.issued_on::text AS issued_on, v.full_name, c.kind, e.title AS event, c.hours::float AS hours, c.verify_code, c.is_revoked
               FROM vol_certificates c JOIN vol_volunteers v ON v.id = c.volunteer_id LEFT JOIN vol_events e ON e.id = c.event_id
              WHERE c.organization_id = $1 AND c.issued_on BETWEEN $2 AND $3 AND ($4::text IS NULL OR c.kind = $4) ORDER BY c.issued_on DESC`,
            [org(u).organizationId, f.from, f.to, f.kind ?? null]);
          return rows.map((r) => ({
            id: r.id, certificateNo: r.certificate_no, issuedOn: r.issued_on, volunteer: r.full_name, kind: ar(CERT, r.kind), event: r.event, hours: r.hours,
            verifyCode: r.verify_code, state: r.is_revoked ? 'ملغاة' : 'سارية', _skipTotal: !!r.is_revoked, _style: r.is_revoked ? 'muted' as const : undefined,
          }));
        },
      },
      {
        ...base, code: 'volunteers.summary', category: 'المتطوعون', title: 'ملخص التطوع', description: 'حالات المتطوعين وأنواعهم، والشكاوى والمقترحات، والشهادات الصادرة في الفترة',
        columns: [{ key: 'section', label: 'البند' }, { key: 'name', label: 'التصنيف' }, { key: 'n', label: 'العدد', type: 'number' }, { key: 'extra', label: 'الساعات', type: 'number' }],
        run: async (u, f) => {
          const d = await this.reports.reports(org(u), { from: f.from, to: f.to });
          const group = (title: string) => ({ section: title, _style: 'group' as const });
          return [
            group('حالات المتطوعين'), ...d.statuses.map((s: { name: string; n: number }) => ({ section: '', name: s.name, n: s.n })),
            group('أنواع المتطوعين النشطين'), ...d.types.map((s: { name: string; n: number }) => ({ section: '', name: s.name, n: s.n })),
            group('الشكاوى والمقترحات والاستفسارات'), ...d.tickets.map((s: { kind: string; status: string; n: number }) => ({ section: '', name: `${s.kind} · ${s.status}`, n: s.n })),
            group('الشهادات الصادرة'), ...d.certificates.map((s: { kind: string; n: number; hours: number }) => ({ section: '', name: s.kind, n: s.n, extra: r2(s.hours) })),
          ];
        },
      },
    ];
    this.registry.register(defs);
  }
}
