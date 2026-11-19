import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { cents, fromCents, today } from './acc-core.service';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { AccountsService } from './accounts.service';
import { addDaysIso, amountOf, AssetsService, bad, dateOf, HELD, idOf, MAINT_AR, optId, str } from './assets.service';
import { CashAccount, Partner } from './entities/accounting.entity';
import { AssetMaintenance, FixedAsset } from './entities/assets.entity';
import { VouchersService } from './vouchers.service';

/** إضافة أشهر لتاريخ (مع تثبيت اليوم في آخر الشهر عند الحاجة) */
export const addMonthsIso = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
};

/** الأصل كثير الأعطال: 3 إصلاحات أو أكثر في الفترة، أو تكلفة صيانة تبلغ 30% من تكلفته */
export const FAILURE_REPAIRS = 3;
export const FAILURE_RATIO = 30;

/**
 * صيانة الأصول الثابتة: سجل الصيانة الوقائية وإصلاح الأعطال بتكلفتها ومدة توقف الأصل،
 * وتحديث موعد الصيانة الوقائية القادمة، وتقرير الأصول كثيرة الأعطال.
 * تُسدَّد التكلفة اختياريًا بسند صرف يمر بمراحل الاعتماد في النظام المالي.
 */
@Injectable()
export class AssetMaintenanceService {
  constructor(
    private readonly db: DataSource,
    private readonly assets: AssetsService,
    private readonly accounts: AccountsService,
    private readonly vouchers: VouchersService,
  ) {}

  async list(actor: OrgUser, f: { assetId?: string; kind?: string; from?: string; to?: string }) {
    const org = actor.organizationId;
    const rows: Record<string, string | number | null>[] = await this.db.query(
      `SELECT m.id, m.record_no, to_char(m.date, 'YYYY-MM-DD') AS date, m.kind, m.description, m.vendor, m.cost, m.downtime_days, m.notes, m.created_by_name,
              a.id AS asset_id, a.code, a.name, g.name AS group_name, v.id AS voucher_id, v.serial AS voucher_serial, v.status AS voucher_status
         FROM acc_asset_maintenance m JOIN acc_assets a ON a.id = m.asset_id JOIN acc_asset_groups g ON g.id = a.group_id LEFT JOIN acc_vouchers v ON v.id = m.voucher_id
        WHERE m.organization_id = $1 AND ($2::uuid IS NULL OR m.asset_id = $2) AND ($3::text IS NULL OR m.kind = $3)
          AND ($4::date IS NULL OR m.date >= $4) AND ($5::date IS NULL OR m.date <= $5)
        ORDER BY m.date DESC, m.record_no DESC LIMIT 2000`,
      [org, optId(f.assetId), f.kind === 'preventive' || f.kind === 'repair' ? f.kind : null, f.from || null, f.to || null]);
    return rows.map((r) => ({
      id: r.id, recordNo: r.record_no, date: r.date, kind: r.kind, kindLabel: MAINT_AR[String(r.kind)], description: r.description, vendor: r.vendor,
      cost: Number(r.cost), downtimeDays: Number(r.downtime_days), notes: r.notes, createdByName: r.created_by_name,
      asset: { id: r.asset_id, code: r.code, name: r.name, groupName: r.group_name },
      voucher: r.voucher_id ? { id: r.voucher_id, serial: r.voucher_serial, status: r.voucher_status } : null,
    }));
  }

  /** تسجيل صيانة: وقائية (تُحدّث موعد الصيانة القادمة) أو إصلاح عطل، والتكلفة تُسدد بسند صرف أو تُسجل للمتابعة فقط */
  async record(actor: OrgUser, input: Record<string, unknown>) {
    this.assets.need(actor, P.assetsMaintain, 'ليست لديك صلاحية تسجيل الصيانة');
    const org = actor.organizationId;
    let id = '';
    await this.db.transaction(async (em) => {
      await this.assets.lock(em, org);
      const a = await this.assets.load(em, org, idOf(input.assetId, 'الأصل'));
      if (!HELD.includes(a.status)) bad('الأصل مستبعد، فلا تُسجل عليه صيانة');
      const kind = input.kind === 'preventive' ? 'preventive' : input.kind === 'repair' ? 'repair' : bad('اختر نوع الصيانة: وقائية أو إصلاح عطل');
      const date = dateOf(input.date, 'تاريخ الصيانة');
      if (date > today()) bad('تاريخ الصيانة في المستقبل');
      const description = str(input.description, 1000) ?? bad(kind === 'repair' ? 'اكتب وصف العطل والإصلاح' : 'اكتب ما تم في الصيانة');
      const cost = input.cost === undefined || input.cost === null || input.cost === '' ? 0 : amountOf(input.cost, 'تكلفة الصيانة', 0);
      const downtimeDays = input.downtimeDays === undefined || input.downtimeDays === null || input.downtimeDays === '' ? 0 : Number(input.downtimeDays);
      if (!Number.isInteger(downtimeDays) || downtimeDays < 0 || downtimeDays > 3650) bad('أيام التوقف رقم صحيح بين 0 و3650');
      const vendor = str(input.vendor, 250);
      let voucherId: string | null = null;
      if (input.pay === true) {
        if (cost <= 0) bad('اكتب تكلفة الصيانة لإصدار سند الصرف');
        voucherId = await this.payVoucher(em, actor, a, date, cost, vendor, description, input);
      }
      const r = await em.getRepository(AssetMaintenance).save(em.create(AssetMaintenance, {
        organizationId: org, recordNo: await this.assets.nextNo(em, 'acc_asset_maintenance', 'record_no', org), assetId: a.id, date, kind, description,
        vendor, cost, downtimeDays, voucherId, notes: str(input.notes, 1000), createdByName: actor.fullName,
      }));
      id = r.id;
      if (kind === 'preventive' && a.maintenancePlan) {
        const next = addMonthsIso(date, a.maintenancePlan.intervalMonths);
        if (next > a.maintenancePlan.nextDate) {
          await em.getRepository(FixedAsset).update({ id: a.id }, { maintenancePlan: { ...a.maintenancePlan, nextDate: next } });
        }
      }
    });
    return (await this.list(actor, {})).find((r) => r.id === id);
  }

  /** سند صرف للصيانة: مدين مصروف الصيانة بمركز تكلفة الأصل، دائن الصندوق أو البنك أو المورد */
  private async payVoucher(em: EntityManager, actor: OrgUser, a: FixedAsset, date: string, cost: number, vendor: string | null, description: string, input: Record<string, unknown>) {
    const org = actor.organizationId;
    const cfg = await this.assets.config(org, em);
    const expense = optId(input.expenseAccountId) ?? cfg.maintenanceAccountId ?? bad('اختر حساب مصروف الصيانة، أو حدده في إعدادات الأصول');
    const acc = await this.accounts.postable(org, expense, em);
    const g = await this.assets.group(org, a.groupId, em);
    const analytic = a.analyticId ?? g.analyticId;
    if (acc.requiresAnalytic && !analytic) bad(`الحساب ${acc.code} يلزمه مركز تكلفة. حدده في مجموعة «${g.name}» أو بطاقة الأصل`);
    const method = (['cash', 'bank', 'credit'] as const).find((m) => m === input.method) ?? bad('اختر طريقة السداد: نقدي أو بنكي أو آجل');
    let accountId: string;
    let partnerId: string | null = null;
    let cashAccountId: string | null = null;
    let partyName = vendor;
    if (method === 'credit') {
      const p = await em.getRepository(Partner).findOne({ where: { id: idOf(input.partnerId, 'المورد'), organizationId: org } }) ?? bad('المورد غير موجود');
      if (!p.accountId) bad(`اربط المورد «${p.name}» بحساب في الدليل`);
      accountId = p.accountId!;
      partnerId = p.id;
      partyName = partyName ?? p.name;
    } else {
      const c = await em.getRepository(CashAccount).findOne({ where: { id: idOf(input.cashAccountId, method === 'bank' ? 'الحساب البنكي' : 'الصندوق'), organizationId: org } }) ?? bad('الحساب غير موجود');
      if (!c.isActive) bad(`«${c.name}» موقوف`);
      if ((method === 'bank') !== (c.kind === 'bank')) bad(method === 'bank' ? 'اختر حسابًا بنكيًا' : 'اختر صندوق نقدية');
      accountId = c.glAccountId;
      cashAccountId = c.id;
      partnerId = optId(input.partnerId);
    }
    const label = `صيانة الأصل ${a.code} ${a.name}: ${description}`.slice(0, 600);
    const amount = fromCents(cents(cost));
    const v = await this.vouchers.insertSystemDraft(em, actor, 'payment', {
      voucherDate: date, partyName: partyName ?? 'جهة الصيانة', partnerId, amount, purpose: label, sourceType: 'assets', sourceRef: a.code,
      method: method === 'bank' ? 'transfer' : method, cashAccountId, counterAccountId: expense,
      lines: [
        { accountId: expense, debit: amount, credit: 0, label, partnerId: null, analytic: analytic && acc.requiresAnalytic ? [{ analyticId: analytic, percent: 100 }] : [] },
        { accountId, debit: 0, credit: amount, label, partnerId },
      ],
    });
    return v.id;
  }

  async remove(actor: OrgUser, id: string) {
    this.assets.need(actor, P.assetsMaintain, 'ليست لديك صلاحية تسجيل الصيانة');
    const r = await this.db.getRepository(AssetMaintenance).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!r) throw new NotFoundException('سجل الصيانة غير موجود');
    if (r.voucherId) {
      const [v] = await this.db.query('SELECT status, serial FROM acc_vouchers WHERE id = $1', [r.voucherId]);
      if (v && !['cancelled', 'rejected'].includes(v.status)) bad(`صدر للصيانة سند صرف رقم ${v.serial}. ألغِ السند أولًا من النظام المالي`);
    }
    await this.db.getRepository(AssetMaintenance).delete({ id });
    return { ok: true };
  }

  /** الأصول كثيرة الأعطال وتكلفة صيانتها في فترة */
  async failures(actor: OrgUser, f: { from?: string; to?: string; groupId?: string }) {
    const org = actor.organizationId;
    const to = f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? f.to : today();
    const from = f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? f.from : addMonthsIso(to, -12);
    const rows: Record<string, string | number | null>[] = await this.db.query(
      `SELECT a.id, a.code, a.name, g.name AS group_name, a.cost, a.cost - a.accum AS nbv, a.status,
              COUNT(*) FILTER (WHERE m.kind = 'repair')::int AS repairs, COUNT(*) FILTER (WHERE m.kind = 'preventive')::int AS preventive,
              COALESCE(SUM(m.cost), 0) AS maint_cost, COALESCE(SUM(m.cost) FILTER (WHERE m.kind = 'repair'), 0) AS repair_cost,
              COALESCE(SUM(m.downtime_days), 0)::int AS downtime, to_char(MAX(m.date) FILTER (WHERE m.kind = 'repair'), 'YYYY-MM-DD') AS last_repair
         FROM acc_asset_maintenance m JOIN acc_assets a ON a.id = m.asset_id JOIN acc_asset_groups g ON g.id = a.group_id
        WHERE m.organization_id = $1 AND m.date BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR a.group_id = $4)
        GROUP BY a.id, g.name ORDER BY repairs DESC, maint_cost DESC`, [org, from, to, optId(f.groupId)]);
    return {
      from, to, threshold: { repairs: FAILURE_REPAIRS, ratio: FAILURE_RATIO },
      rows: rows.map((r) => {
        const cost = Number(r.cost);
        const maint = Number(r.maint_cost);
        const ratio = cost > 0 ? Math.round((maint / cost) * 1000) / 10 : 0;
        const frequent = Number(r.repairs) >= FAILURE_REPAIRS || ratio >= FAILURE_RATIO;
        return {
          assetId: r.id, code: r.code, name: r.name, groupName: r.group_name, cost, nbv: Number(r.nbv), repairs: Number(r.repairs), preventive: Number(r.preventive),
          maintenanceCost: maint, repairCost: Number(r.repair_cost), downtimeDays: Number(r.downtime), lastRepair: r.last_repair, ratio, frequent,
          advice: frequent ? (ratio >= 50 ? 'تكلفة الصيانة تقارب قيمة الأصل: يُقترح دراسة استبداله أو تخريده' : 'أعطال متكررة: راجع خطة الصيانة الوقائية وحالة الأصل') : null,
        };
      }),
    };
  }

  /** الصيانة الوقائية المستحقة أو القريبة */
  async due(actor: OrgUser) {
    const org = actor.organizationId;
    const cfg = await this.assets.config(org);
    const limit = addDaysIso(today(), cfg.alertDays);
    const rows: Record<string, string | number | null>[] = await this.db.query(
      `SELECT a.id, a.code, a.name, g.name AS group_name, a.maintenance_plan->>'nextDate' AS next_date, (a.maintenance_plan->>'intervalMonths')::int AS interval,
              a.location, e.full_name AS custodian
         FROM acc_assets a JOIN acc_asset_groups g ON g.id = a.group_id LEFT JOIN hr_employees e ON e.id = a.custodian_employee_id
        WHERE a.organization_id = $1 AND a.maintenance_plan IS NOT NULL AND a.status IN ('construction', 'pending_purchase', 'active', 'pending_sale')
          AND a.maintenance_plan->>'nextDate' <= $2 ORDER BY 5`, [org, limit]);
    const t = today();
    return rows.map((r) => ({
      assetId: r.id, code: r.code, name: r.name, groupName: r.group_name, nextDate: r.next_date, intervalMonths: r.interval, location: r.location,
      custodianName: r.custodian, overdue: String(r.next_date) < t,
    }));
  }
}
