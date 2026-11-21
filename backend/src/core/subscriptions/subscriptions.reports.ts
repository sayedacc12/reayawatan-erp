import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PLATFORM_PERMISSIONS as P } from '../core.manifest';
import { addDays, todayRiyadh } from '../organizations/org-access';
import { OrganizationsService } from '../organizations/organizations.service';
import { ar, periodFilters, r2, selectFilter } from '../reports/report-helpers';
import { ReportDefinition } from '../reports/report.types';
import { ReportsRegistry } from '../reports/reports.registry';
import { CYCLE_MONTHS } from './contract-render';

const STATE: Record<string, string> = {
  trial: 'فترة تجريبية', trial_expired: 'انتهت التجربة', awaiting_contract: 'بانتظار العقد', active: 'اشتراك ساري', expired: 'اشتراك منتهٍ', suspended: 'موقوفة',
};
const APP: Record<string, string> = { submitted: 'بانتظار المراجعة', returned: 'معاد للاستكمال', approved: 'معتمد', rejected: 'مرفوض' };
const CONTRACT: Record<string, string> = { draft: 'مسودة', sent: 'بانتظار توقيع الشركة', changes_requested: 'طلبت الشركة تعديلًا', signed: 'موقّع وساري', cancelled: 'ملغى' };
const CYCLE: Record<string, string> = { monthly: 'شهرية', quarterly: 'ربع سنوية', semiannual: 'نصف سنوية', annual: 'سنوية' };
const WITHIN: Record<string, string> = { '14': 'خلال 14 يومًا', '30': 'خلال 30 يومًا', '60': 'خلال 60 يومًا', '90': 'خلال 90 يومًا' };

/** تقارير إدارة المنصة: الجمعيات واشتراكاتها، طلبات الاشتراك، العقود، والإيرادات */
@Injectable()
export class SubscriptionsReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly orgs: OrganizationsService, private readonly db: DataSource) {}

  onModuleInit() {
    const base = { module: 'platform', permission: P.reportsRead, scope: 'platform' as const };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'platform.organizations', category: 'الجمعيات', title: 'الجمعيات وحالة اشتراكها', description: 'كل الجمعيات بحالة الاشتراك وتواريخه وقيمته وعدد المستخدمين',
        filters: [selectFilter('state', 'الحالة', STATE)], link: '/platform/organizations/{id}', orientation: 'landscape',
        columns: [
          { key: 'name', label: 'الشركة' }, { key: 'slug', label: 'المعرّف' }, { key: 'state', label: 'الحالة' }, { key: 'createdAt', label: 'تاريخ التسجيل', type: 'date' },
          { key: 'trialEndsOn', label: 'نهاية التجربة', type: 'date' }, { key: 'startsOn', label: 'بداية الاشتراك', type: 'date' },
          { key: 'endsOn', label: 'نهاية الاشتراك', type: 'date' }, { key: 'cycle', label: 'دورة الفوترة' }, { key: 'price', label: 'قيمة الدورة', type: 'money' },
          { key: 'annual', label: 'القيمة السنوية', type: 'money', total: true }, { key: 'users', label: 'المستخدمون', type: 'number', total: true },
          { key: 'contract', label: 'العقد' },
        ],
        run: async (_u, f) => (await this.orgs.list())
          .filter((o) => !f.state || o.state === f.state)
          .map((o) => ({
            id: o.id, name: o.name, slug: o.slug, state: ar(STATE, o.state), createdAt: o.createdAt, trialEndsOn: o.trialEndsOn, startsOn: o.subscriptionStartsOn,
            endsOn: o.subscriptionEndsOn, cycle: ar(CYCLE, o.billingCycle), price: o.subscriptionPrice,
            annual: o.state === 'active' && o.subscriptionPrice && o.billingCycle ? r2((Number(o.subscriptionPrice) * 12) / CYCLE_MONTHS[o.billingCycle]) : null,
            users: Number(o.userCount ?? 0), contract: ar(CONTRACT, o.contractStatus),
          })),
      },
      {
        ...base, code: 'platform.renewals', category: 'الجمعيات', title: 'التجارب والاشتراكات القريبة من الانتهاء', description: 'الجمعيات التي تنتهي تجربتها أو اشتراكها خلال المدة المختارة أو انتهت، لمتابعة التجديد',
        filters: [{ ...selectFilter('days', 'المدة', WITHIN), default: '30', required: true }], link: '/platform/organizations/{id}',
        columns: [
          { key: 'name', label: 'الشركة' }, { key: 'state', label: 'الحالة' }, { key: 'kind', label: 'ما ينتهي' }, { key: 'date', label: 'تاريخ الانتهاء', type: 'date' },
          { key: 'daysLeft', label: 'الأيام المتبقية', type: 'number' }, { key: 'annual', label: 'القيمة السنوية', type: 'money', total: true },
        ],
        run: async (_u, f) => {
          const today = todayRiyadh();
          const until = addDays(today, Number(f.days ?? 30));
          const out = [];
          for (const o of await this.orgs.list()) {
            const isTrial = ['trial', 'trial_expired'].includes(o.state);
            const date = isTrial ? o.trialEndsOn : ['active', 'expired'].includes(o.state) ? o.subscriptionEndsOn : null;
            if (!date || date > until) continue;
            const left = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
            out.push({
              id: o.id, name: o.name, state: ar(STATE, o.state), kind: isTrial ? 'الفترة التجريبية' : 'الاشتراك', date, daysLeft: left,
              annual: o.subscriptionPrice && o.billingCycle ? r2((Number(o.subscriptionPrice) * 12) / CYCLE_MONTHS[o.billingCycle]) : null,
              _style: left < 0 ? 'strong' as const : undefined,
            });
          }
          return out.sort((a, b) => a.daysLeft - b.daysLeft);
        },
      },
      {
        ...base, code: 'platform.revenue', category: 'الإيرادات', title: 'إيرادات الاشتراكات حسب دورة الفوترة', description: 'عدد الاشتراكات السارية وقيمتها السنوية لكل دورة فوترة (قبل الضريبة)',
        columns: [
          { key: 'cycle', label: 'دورة الفوترة' }, { key: 'count', label: 'الاشتراكات السارية', type: 'number', total: true },
          { key: 'periodTotal', label: 'إجمالي قيمة الدورة', type: 'money', total: true }, { key: 'annual', label: 'القيمة السنوية', type: 'money', total: true },
          { key: 'share', label: 'النسبة', type: 'percent' },
        ],
        run: async () => {
          const active = (await this.orgs.list()).filter((o) => o.state === 'active' && o.subscriptionPrice && o.billingCycle);
          const by = new Map<string, { cycle: string; count: number; periodTotal: number; annual: number }>();
          for (const o of active) {
            const g = by.get(o.billingCycle!) ?? { cycle: ar(CYCLE, o.billingCycle)!, count: 0, periodTotal: 0, annual: 0 };
            g.count++; g.periodTotal += Number(o.subscriptionPrice); g.annual += (Number(o.subscriptionPrice) * 12) / CYCLE_MONTHS[o.billingCycle!];
            by.set(o.billingCycle!, g);
          }
          const total = [...by.values()].reduce((s, g) => s + g.annual, 0);
          return [...by.values()].map((g) => ({ ...g, periodTotal: r2(g.periodTotal), annual: r2(g.annual), share: total ? r2((g.annual / total) * 100) : null }));
        },
      },
      {
        ...base, code: 'platform.applications', category: 'الطلبات والعقود', title: 'طلبات الاشتراك', description: 'طلبات تسجيل الجمعيات في الفترة بحالتها وبياناتها',
        filters: [...periodFilters('الطلب'), selectFilter('status', 'الحالة', APP)], link: '/platform/applications/{id}', orientation: 'landscape',
        columns: [
          { key: 'number', label: 'رقم الطلب' }, { key: 'createdAt', label: 'التاريخ', type: 'date' }, { key: 'orgName', label: 'الشركة' }, { key: 'city', label: 'المدينة' },
          { key: 'license', label: 'رقم الترخيص' }, { key: 'licenseEnd', label: 'نهاية الترخيص', type: 'date' }, { key: 'director', label: 'المدير التنفيذي' },
          { key: 'phone', label: 'الجوال' }, { key: 'email', label: 'البريد' }, { key: 'status', label: 'الحالة' }, { key: 'decidedAt', label: 'تاريخ القرار', type: 'date' },
        ],
        run: async (_u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT id, number, created_at, org_name, city, license_number, license_end_date::text AS license_end, executive_director, org_phone, org_email, status, decided_at
               FROM subscription_applications WHERE (created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1 AND $2 AND ($3::text IS NULL OR status = $3)
              ORDER BY created_at DESC`, [f.from, f.to, f.status ?? null]);
          return rows.map((r) => ({
            id: r.id, number: r.number, createdAt: r.created_at, orgName: r.org_name, city: r.city, license: r.license_number, licenseEnd: r.license_end,
            director: r.executive_director, phone: r.org_phone, email: r.org_email, status: ar(APP, r.status), decidedAt: r.decided_at,
          }));
        },
      },
      {
        ...base, code: 'platform.contracts', category: 'الطلبات والعقود', title: 'عقود الاشتراك', description: 'العقود الإلكترونية بحالتها وتواريخ الإرسال والتوقيع واسم الموقّع',
        filters: [selectFilter('status', 'الحالة', CONTRACT)], link: '/platform/contracts/{id}',
        columns: [
          { key: 'number', label: 'رقم العقد' }, { key: 'orgName', label: 'الشركة' }, { key: 'status', label: 'الحالة' }, { key: 'sentAt', label: 'تاريخ الإرسال', type: 'date' },
          { key: 'signedAt', label: 'تاريخ التوقيع', type: 'date' }, { key: 'signer', label: 'الموقّع' }, { key: 'createdAt', label: 'تاريخ الإنشاء', type: 'date' },
        ],
        run: async (_u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT c.id, c.number, o.name AS org_name, c.status, c.sent_at, c.signed_at, c.signer_name, c.signer_title, c.created_at
               FROM subscription_contracts c LEFT JOIN organizations o ON o.id = c.organization_id
              WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.created_at DESC`, [f.status ?? null]);
          return rows.map((r) => ({
            id: r.id, number: r.number, orgName: r.org_name, status: ar(CONTRACT, r.status), sentAt: r.sent_at, signedAt: r.signed_at,
            signer: r.signer_name ? `${r.signer_name}${r.signer_title ? ` (${r.signer_title})` : ''}` : null, createdAt: r.created_at,
          }));
        },
      },
    ];
    this.registry.register(defs);
  }
}
