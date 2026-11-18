import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, periodFilters, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { NEWS_STATUS, PROGRAM_STATUS } from './content.service';
import { MESSAGE_STATUS, TOPICS } from './site.service';
import { DONATION_STATUS, KIND_AR, SUB_STATUS, receiptLabel } from './store.service';
import { WEBSITE_PERMISSIONS as P } from './website.manifest';

const RIYADH = `AT TIME ZONE 'Asia/Riyadh'`;

/** تقارير الموقع الإلكتروني والمتجر في البنية الموحدة */
@Injectable()
export class WebsiteReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    const base = { module: 'website', permission: P.reports };
    const programs = dynamicFilter('program', 'البرنامج', async (u) => [
      { value: 'general', label: 'التبرع العام' },
      ...(await this.db.query(`SELECT id AS value, name AS label FROM web_programs WHERE organization_id = $1 ORDER BY sort_order`, [u.organizationId])),
    ]);
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'website.donations', category: 'المتجر', title: 'سجل التبرعات', description: 'التبرعات المدفوعة من الموقع بإيصالاتها وسندات القبض',
        filters: [...periodFilters(), programs, selectFilter('kind', 'نوع التبرع', KIND_AR)], link: '/website/donations?id={id}', orientation: 'landscape',
        columns: [
          { key: 'receipt', label: 'الإيصال' }, { key: 'date', label: 'التاريخ', type: 'datetime' }, { key: 'program', label: 'البرنامج' }, { key: 'kind', label: 'النوع' },
          { key: 'donor', label: 'المتبرع' }, { key: 'phone', label: 'الجوال' }, { key: 'monthly', label: 'شهري', type: 'bool' }, { key: 'gift', label: 'إهداء إلى' },
          { key: 'voucher', label: 'سند القبض' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT d.id, d.receipt_no, d.paid_at, d.program_name, d.kind, d.donor_name, d.donor_phone, d.monthly, d.gift->>'to' AS gift, d.amount::float AS amount, v.serial
               FROM web_donations d LEFT JOIN acc_vouchers v ON v.id = d.voucher_id
              WHERE d.organization_id = $1 AND d.status = 'paid' AND (d.paid_at ${RIYADH})::date BETWEEN $2 AND $3
                AND ($4::text IS NULL OR ($4 = 'general' AND d.program_id IS NULL) OR d.program_id::text = $4) AND ($5::text IS NULL OR d.kind = $5)
              ORDER BY d.paid_at`, [org(u).organizationId, f.from, f.to, f.program ?? null, f.kind ?? null]);
          return rows.map((r: Record<string, unknown>) => ({
            id: r.id, receipt: receiptLabel(r.receipt_no as number), date: r.paid_at, program: r.program_name, kind: ar(KIND_AR, r.kind), donor: r.donor_name || 'فاعل خير',
            phone: r.donor_phone, monthly: r.monthly, gift: r.gift, voucher: r.serial ?? 'لم يُنشأ', amount: r.amount,
          }));
        },
      },
      {
        ...base, code: 'website.by_program', category: 'المتجر', title: 'حصيلة البرامج', description: 'المحصّل لكل برنامج مقابل المستهدف ونسبة الإنجاز وعدد المتبرعين',
        filters: [],
        columns: [
          { key: 'name', label: 'البرنامج' }, { key: 'kind', label: 'النوع' }, { key: 'status', label: 'الحالة' }, { key: 'goal', label: 'المستهدف', type: 'money', total: true },
          { key: 'raised', label: 'المحصّل', type: 'money', total: true }, { key: 'progress', label: 'نسبة الإنجاز', type: 'percent' }, { key: 'count', label: 'عدد التبرعات', type: 'number', total: true },
          { key: 'endDate', label: 'نهاية الحملة', type: 'date' },
        ],
        run: async (u) => {
          const rows = await this.db.query(`SELECT name, status, store, raised::float AS raised, donations_count FROM web_programs WHERE organization_id = $1 ORDER BY sort_order`, [org(u).organizationId]);
          return rows.map((r: { name: string; status: string; store: { kind?: string; goal?: number; endDate?: string; on?: boolean }; raised: number; donations_count: number }) => ({
            name: r.name, kind: r.store?.on ? (r.store.kind === 'waqf' ? 'وقفي' : 'مشروع') : 'غير منشور في المتجر', status: ar(PROGRAM_STATUS, r.status),
            goal: r.store?.goal || null, raised: r.raised, progress: r.store?.goal ? Math.round((r.raised / r.store.goal) * 1000) / 10 : null, count: r.donations_count, endDate: r.store?.endDate ?? null,
          }));
        },
      },
      {
        ...base, code: 'website.daily', category: 'المتجر', title: 'التبرعات اليومية', description: 'عدد التبرعات ومبالغها في كل يوم من الفترة',
        filters: periodFilters(),
        columns: [{ key: 'day', label: 'اليوم', type: 'date' }, { key: 'count', label: 'عدد التبرعات', type: 'number', total: true }, { key: 'donors', label: 'المتبرعون', type: 'number' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true }],
        run: async (u, f) => this.db.query(
          `SELECT (paid_at ${RIYADH})::date::text AS day, count(*)::int AS count, count(DISTINCT donor_phone)::int AS donors, sum(amount)::float AS amount
             FROM web_donations WHERE organization_id = $1 AND status = 'paid' AND (paid_at ${RIYADH})::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`,
          [org(u).organizationId, f.from, f.to]),
      },
      {
        ...base, code: 'website.subscriptions', category: 'المتجر', title: 'التبرعات الشهرية', description: 'المتبرعون شهريًا ومبالغهم وعدد الأشهر المدفوعة وموعد الاستحقاق القادم',
        filters: [selectFilter('status', 'الحالة', SUB_STATUS)],
        columns: [
          { key: 'donor', label: 'المتبرع' }, { key: 'phone', label: 'الجوال' }, { key: 'program', label: 'البرنامج' }, { key: 'amount', label: 'المبلغ الشهري', type: 'money', total: true },
          { key: 'charges', label: 'الأشهر المدفوعة', type: 'number', total: true }, { key: 'nextDue', label: 'الاستحقاق القادم', type: 'date' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT donor_name, donor_phone, program_name, amount::float AS amount, charges, next_due::text AS next_due, status FROM web_subscriptions
              WHERE organization_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY status, next_due`, [org(u).organizationId, f.status ?? null]);
          return rows.map((r: Record<string, unknown>) => ({ donor: r.donor_name || 'فاعل خير', phone: r.donor_phone, program: r.program_name, amount: r.amount, charges: r.charges, nextDue: r.next_due, status: ar(SUB_STATUS, r.status) }));
        },
      },
      {
        ...base, code: 'website.pending', category: 'المتجر', title: 'تبرعات لم يكتمل دفعها', description: 'عمليات بدأها الزوار ولم يكتمل دفعها، للمتابعة',
        filters: periodFilters(),
        columns: [{ key: 'date', label: 'التاريخ', type: 'datetime' }, { key: 'program', label: 'البرنامج' }, { key: 'donor', label: 'المتبرع' }, { key: 'phone', label: 'الجوال' }, { key: 'status', label: 'الحالة' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true }],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT created_at, program_name, donor_name, donor_phone, status, amount::float AS amount FROM web_donations
              WHERE organization_id = $1 AND status <> 'paid' AND (created_at ${RIYADH})::date BETWEEN $2 AND $3 ORDER BY created_at DESC`, [org(u).organizationId, f.from, f.to]);
          return rows.map((r: Record<string, unknown>) => ({ date: r.created_at, program: r.program_name, donor: r.donor_name || '—', phone: r.donor_phone, status: ar(DONATION_STATUS, r.status), amount: r.amount }));
        },
      },
      {
        ...base, code: 'website.news', category: 'المحتوى', title: 'سجل الأخبار', description: 'الأخبار وحالتها ومن أضافها ومن نشرها وعدد المشاهدات',
        filters: [selectFilter('status', 'الحالة', NEWS_STATUS)], link: '/website/news/{id}',
        columns: [{ key: 'date', label: 'تاريخ الخبر', type: 'date' }, { key: 'title', label: 'العنوان' }, { key: 'status', label: 'الحالة' }, { key: 'by', label: 'أضافه' }, { key: 'publisher', label: 'نشره' }, { key: 'views', label: 'المشاهدات', type: 'number', total: true }],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT id, news_date::text AS date, title, status, created_by_name AS by, published_by_name AS publisher, views FROM web_news
              WHERE organization_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY news_date DESC`, [org(u).organizationId, f.status ?? null]);
          return rows.map((r: Record<string, unknown>) => ({ ...r, status: ar(NEWS_STATUS, r.status) }));
        },
      },
      {
        ...base, code: 'website.messages', category: 'الزوار', title: 'رسائل الزوار', description: 'رسائل نموذج تواصل معنا ونوعها وحالة متابعتها',
        filters: [...periodFilters(), selectFilter('status', 'الحالة', MESSAGE_STATUS), selectFilter('topic', 'النوع', TOPICS)],
        columns: [{ key: 'date', label: 'التاريخ', type: 'datetime' }, { key: 'name', label: 'الاسم' }, { key: 'contact', label: 'التواصل' }, { key: 'topic', label: 'النوع' }, { key: 'status', label: 'الحالة' }, { key: 'handler', label: 'المتابع' }, { key: 'note', label: 'ما تم' }],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT created_at, name, COALESCE(phone, email) AS contact, topic, status, handled_by_name, reply_note FROM web_messages
              WHERE organization_id = $1 AND (created_at ${RIYADH})::date BETWEEN $2 AND $3 AND ($4::text IS NULL OR status = $4) AND ($5::text IS NULL OR topic = $5) ORDER BY created_at DESC`,
            [org(u).organizationId, f.from, f.to, f.status ?? null, f.topic ?? null]);
          return rows.map((r: Record<string, unknown>) => ({ date: r.created_at, name: r.name, contact: r.contact, topic: ar(TOPICS, r.topic), status: ar(MESSAGE_STATUS, r.status), handler: r.handled_by_name, note: r.reply_note }));
        },
      },
    ];
    this.registry.register(defs);
  }
}
