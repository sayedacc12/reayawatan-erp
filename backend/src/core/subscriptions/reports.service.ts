import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { addDays, todayRiyadh } from '../organizations/org-access';
import { CYCLE_MONTHS } from './contract-render';

/** تقارير الاشتراكات لمدير المنصة: الطلبات، حالات الجمعيات، العقود، الإيرادات، والتنبيهات */
@Injectable()
export class SubscriptionReportsService {
  constructor(
    private readonly db: DataSource,
    private readonly orgs: OrganizationsService,
    private readonly catalog: ModuleCatalogService,
  ) {}

  async overview() {
    const today = todayRiyadh();
    const [orgs, apps, contracts, monthly] = await Promise.all([
      this.orgs.list(),
      this.db.query(`SELECT status, count(*)::int AS n FROM subscription_applications GROUP BY status`),
      this.db.query(`SELECT status, count(*)::int AS n FROM subscription_contracts GROUP BY status`),
      this.db.query(`
        SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM') AS month, count(*)::int AS n
        FROM subscription_applications WHERE created_at > now() - interval '6 months' GROUP BY 1 ORDER BY 1`),
    ]);
    const count = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
    const states: Record<string, number> = {};
    for (const o of orgs) states[o.state] = (states[o.state] ?? 0) + 1;

    // القيمة السنوية للاشتراكات السارية (قبل الضريبة)
    const active = orgs.filter((o) => o.state === 'active' && o.subscriptionPrice && o.billingCycle);
    const annualRevenue = active.reduce((s, o) => s + (o.subscriptionPrice! * 12) / CYCLE_MONTHS[o.billingCycle!], 0);

    const in14 = addDays(today, 14);
    const in30 = addDays(today, 30);
    const pick = (o: (typeof orgs)[number], date: string | null) => ({ id: o.id, name: o.name, slug: o.slug, date });
    const trialsEnding = orgs.filter((o) => o.state === 'trial' && o.trialEndsOn && o.trialEndsOn <= in14)
      .map((o) => pick(o, o.trialEndsOn)).sort((a, b) => a.date!.localeCompare(b.date!));
    const expiring = orgs.filter((o) => o.state === 'active' && o.subscriptionEndsOn && o.subscriptionEndsOn <= in30)
      .map((o) => pick(o, o.subscriptionEndsOn)).sort((a, b) => a.date!.localeCompare(b.date!));
    const blocked = orgs.filter((o) => ['trial_expired', 'expired', 'awaiting_contract'].includes(o.state))
      .map((o) => ({ ...pick(o, o.trialEndsOn ?? o.subscriptionEndsOn), state: o.state }));

    // انتشار الشاشات: كم جمعية مسموح لها بكل شاشة
    const screens = this.catalog.screenCatalog().filter((m) => !m.locked).flatMap((m) => m.screens.map((s) => ({
      path: s.path, label: `${m.name}: ${s.label}`,
      organizations: orgs.filter((o) => !o.allowedScreens || o.allowedScreens.includes(s.path)).length,
    })));

    return {
      totals: { organizations: orgs.length, annualRevenue: Math.round(annualRevenue * 100) / 100, activeSubscriptions: active.length },
      states, applications: count(apps), contracts: count(contracts), monthlyApplications: monthly,
      trialsEnding, expiring, blocked, screens,
    };
  }
}
