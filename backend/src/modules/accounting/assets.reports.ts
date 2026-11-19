import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, periodFilters, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition, ReportRow } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { today } from './acc-core.service';
import { AssetOpsService } from './asset-ops.service';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { AssetBudgetService } from './asset-budget.service';
import { AssetMaintenanceService } from './asset-maintenance.service';
import { ASSET_STATUS_AR, AssetsService, costMove, CUSTODY_AR, DISPOSAL_KINDS, MAINT_AR, MOVE_AR } from './assets.service';
import { addDays, byAsset, computeDepreciation, DEP_METHOD_AR, lifeOf, monthEnd, monthStart, monthsEquivalent } from './depreciation';
import { AssetGroup, AssetMove, DepLine, FixedAsset } from './entities/assets.entity';

const r2 = (n: number) => Math.round(n * 100) / 100;
const STATUS_FILTER: Record<string, string> = { books: 'في الدفاتر (في الخدمة وبانتظار البيع)', ...ASSET_STATUS_AR, disposed: 'المستبعدة (مباع ومخرد)' };
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** تقارير الأصول الثابتة في تبويب تقارير النظام المالي (مجموعة «الأصول الثابتة») */
@Injectable()
export class AssetsReports implements OnModuleInit {
  constructor(
    private readonly registry: ReportsRegistry,
    private readonly db: DataSource,
    private readonly assets: AssetsService,
    private readonly ops: AssetOpsService,
    private readonly maint: AssetMaintenanceService,
    private readonly budget: AssetBudgetService,
  ) {}

  private groupOptions = async (u: { organizationId: string }) =>
    (await this.db.query('SELECT id AS value, name AS label FROM acc_asset_groups WHERE organization_id = $1 ORDER BY sort_order', [u.organizationId])) as { value: string; label: string }[];

  private assetOptions = async (u: { organizationId: string }) =>
    (await this.db.query(`SELECT id AS value, code || ' ' || name AS label FROM acc_assets WHERE organization_id = $1 AND status <> 'draft' ORDER BY asset_no`, [u.organizationId])) as { value: string; label: string }[];

  private employeeOptions = async (u: { organizationId: string }) =>
    (await this.db.query(`SELECT DISTINCT e.id AS value, e.full_name AS label FROM hr_employees e JOIN acc_assets a ON a.custodian_employee_id = e.id WHERE e.organization_id = $1 ORDER BY 2`, [u.organizationId]).catch(() => [])) as { value: string; label: string }[];

  /** حركة الأصول ومجمع إهلاكها لكل أصل في فترة */
  private async rollForward(orgId: string, from: string, to: string, groupId?: string) {
    const assets = await this.db.getRepository(FixedAsset).find({ where: { organizationId: orgId, ...(groupId ? { groupId } : {}) }, order: { assetNo: 'ASC' } });
    const ids = new Set(assets.map((a) => a.id));
    const movesOf = byAsset(ids.size ? await this.db.getRepository(AssetMove).find({ where: { organizationId: orgId, status: 'done' } }) : [], ids);
    const linesOf = byAsset(ids.size ? await this.db.getRepository(DepLine).find({ where: { organizationId: orgId, active: true } }) : [], ids);
    const groups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: orgId }, order: { sortOrder: 'ASC' } });
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const acq = (m: AssetMove) => costMove(m);
    const disp = (m: AssetMove) => DISPOSAL_KINDS.includes(m.kind);
    const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));
    const rows = assets.map((a) => {
      const mv = (movesOf.get(a.id) ?? []).filter((m) => m.kind !== 'wip');
      const ln = linesOf.get(a.id) ?? [];
      const costOpening = sum(mv.filter((m) => m.date < from).map((m) => m.amount));
      const additions = sum(mv.filter((m) => acq(m) && m.date >= from && m.date <= to).map((m) => m.amount));
      const disposals = sum(mv.filter((m) => disp(m) && m.date >= from && m.date <= to).map((m) => -m.amount));
      const accumOpening = sum([...mv.filter((m) => m.date < from).map((m) => m.accumDelta), ...ln.filter((l) => l.toDate < from).map((l) => l.amount)]);
      // إهلاك الفترة يشمل هبوط القيمة (يُضاف لمجمع الإهلاك)
      const depreciation = sum([...ln.filter((l) => l.toDate >= from && l.toDate <= to).map((l) => l.amount), ...mv.filter((m) => acq(m) && m.date >= from && m.date <= to).map((m) => m.accumDelta)]);
      const accumDisposed = sum(mv.filter((m) => disp(m) && m.date >= from && m.date <= to).map((m) => -m.accumDelta));
      const costClosing = r2(costOpening + additions - disposals);
      const accumClosing = r2(accumOpening + depreciation - accumDisposed);
      return { asset: a, group: groupById.get(a.groupId)!, costOpening, additions, disposals, costClosing, accumOpening, depreciation, accumDisposed, accumClosing, nbv: r2(costClosing - accumClosing) };
    }).filter((r) => r.costOpening || r.additions || r.disposals || r.accumOpening || r.depreciation);
    return { rows, groups };
  }

  onModuleInit() {
    const base = { module: 'accounting', category: 'الأصول الثابتة', permission: [P.assetsRead, P.reports] };
    const money = (key: string, label: string, total = true) => ({ key, label, type: 'money' as const, total });
    const rfKeys = ['costOpening', 'additions', 'disposals', 'costClosing', 'accumOpening', 'depreciation', 'accumDisposed', 'accumClosing', 'nbv'] as const;

    const defs: ReportDefinition[] = [
      {
        ...base, code: 'accounting.assets.register', title: 'سجل الأصول الثابتة',
        description: 'كل الأصول بتكلفتها ومجمع إهلاكها وصافي قيمتها، والعهدة والموقع والجهة المسؤولة',
        filters: [dynamicFilter('groupId', 'المجموعة', this.groupOptions), { ...selectFilter('status', 'الحالة', STATUS_FILTER), default: 'books' }],
        link: '/accounting/assets/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الترميز' }, { key: 'name', label: 'الأصل' }, { key: 'groupName', label: 'المجموعة' }, { key: 'statusLabel', label: 'الحالة' },
          { key: 'custodianName', label: 'العهدة لدى' }, { key: 'unitName', label: 'الجهة المسؤولة' }, { key: 'location', label: 'الموقع' },
          { key: 'inServiceDate', label: 'تاريخ الشراء', type: 'date' }, money('cost', 'التكلفة'), money('accum', 'مجمع الإهلاك'), money('nbv', 'صافي القيمة'),
          { key: 'depreciatedThrough', label: 'آخر إهلاك حتى', type: 'date' },
        ],
        run: async (u, f) => (await this.assets.list(org(u), { groupId: f.groupId, status: f.status })) as unknown as ReportRow[],
      },
      {
        ...base, code: 'accounting.assets.roll-forward', title: 'جدول حركة الأصول الثابتة والإهلاك',
        description: 'بطريقة عرض الميزانية: رصيد أول الفترة والإضافات والاستبعادات ورصيد آخر الفترة، ثم مجمع الإهلاك وصافي القيمة لكل مجموعة',
        filters: [...periodFilters(), { ...selectFilter('detail', 'العرض', { group: 'حسب المجموعة', asset: 'تفصيلي حسب الأصل' }, ''), default: 'group', required: true }],
        orientation: 'landscape', indentColumn: 'name',
        columns: [
          { key: 'name', label: 'المجموعة / الأصل' }, money('costOpening', 'التكلفة أول الفترة'), money('additions', 'الإضافات'), money('disposals', 'الاستبعادات'),
          money('costClosing', 'التكلفة آخر الفترة'), money('accumOpening', 'مجمع الإهلاك أول الفترة'), money('depreciation', 'إهلاك الفترة'),
          money('accumDisposed', 'مجمع المستبعدات'), money('accumClosing', 'مجمع الإهلاك آخر الفترة'), money('nbv', 'صافي القيمة الدفترية'),
        ],
        run: async (u, f) => {
          const { rows, groups } = await this.rollForward(org(u).organizationId, f.from!, f.to!);
          const out: ReportRow[] = [];
          for (const g of groups) {
            const rs = rows.filter((r) => r.group.id === g.id);
            if (!rs.length) continue;
            const agg = Object.fromEntries(rfKeys.map((k) => [k, r2(rs.reduce((s, r) => s + r[k], 0))]));
            out.push({ name: `${g.name} (${rs.length} أصل)`, ...agg, _style: f.detail === 'asset' ? 'strong' : undefined, _skipTotal: false });
            if (f.detail === 'asset') {
              for (const r of rs) out.push({ name: `${r.asset.code} ${r.asset.name}`, _level: 1, _skipTotal: true, ...Object.fromEntries(rfKeys.map((k) => [k, r[k]])) });
            }
          }
          return { rows: out, notes: ['صافي القيمة الدفترية = التكلفة آخر الفترة − مجمع الإهلاك آخر الفترة.', 'الإضافات تشمل إعادة التقييم والرسملة، وإهلاك الفترة يشمل هبوط القيمة. الأصول تحت التنفيذ لا تظهر حتى رسملتها.'] };
        },
      },
      {
        ...base, code: 'accounting.assets.monthly-depreciation', title: 'الإهلاك الشهري حسب المجموعة',
        description: 'الإهلاك المرحّل لكل شهر من السنة لكل مجموعة، للمقارنة ومتابعة انتظام الاحتساب',
        filters: [{ key: 'year', label: 'السنة', type: 'year', default: 'currentYear', required: true }],
        orientation: 'landscape',
        columns: [{ key: 'groupName', label: 'المجموعة' }],
        run: async (u, f) => {
          const y = f.year ?? today().slice(0, 4);
          const rows: { group_id: string; name: string; m: string; amount: string }[] = await this.db.query(
            `SELECT g.id AS group_id, g.name, to_char(l.to_date, 'MM') AS m, SUM(l.amount) AS amount FROM acc_asset_dep_lines l JOIN acc_asset_groups g ON g.id = l.group_id
              WHERE l.organization_id = $1 AND l.active AND to_char(l.to_date, 'YYYY') = $2 GROUP BY 1, 2, 3 ORDER BY 2`, [org(u).organizationId, y]);
          const groups = [...new Map(rows.map((r) => [r.group_id, r.name])).entries()];
          const out = groups.map(([id, name]) => {
            const row: ReportRow = { groupName: name };
            let total = 0;
            for (let m = 1; m <= 12; m++) {
              const v = Number(rows.find((r) => r.group_id === id && Number(r.m) === m)?.amount ?? 0);
              row[`m${m}`] = v;
              total += v;
            }
            row.total = r2(total);
            return row;
          });
          return {
            rows: out,
            columns: [{ key: 'groupName', label: 'المجموعة' }, ...MONTHS.map((n, i) => ({ key: `m${i + 1}`, label: n, type: 'money' as const, total: true })), { key: 'total', label: 'الإجمالي', type: 'money' as const, total: true }],
          };
        },
      },
      {
        ...base, code: 'accounting.assets.card', title: 'كشف حركة أصل',
        description: 'كل حركات الأصل بالترتيب: الاقتناء والإضافات والإهلاك والاستبعاد، مع رصيد التكلفة ومجمع الإهلاك بعد كل حركة',
        filters: [dynamicFilter('assetId', 'الأصل', this.assetOptions, '', true)],
        columns: [
          { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kind', label: 'الحركة' }, { key: 'description', label: 'البيان' },
          money('cost', 'التكلفة', false), money('dep', 'الإهلاك'), { key: 'costBalance', label: 'رصيد التكلفة', type: 'money' },
          { key: 'accumBalance', label: 'رصيد مجمع الإهلاك', type: 'money' }, { key: 'nbv', label: 'صافي القيمة', type: 'money' },
        ],
        run: async (u, f) => {
          if (!f.assetId) return [];
          const a = await this.assets.get(org(u), f.assetId);
          type Ev = { date: string; kind: string; description: string; cost: number; accum: number; dep: number; order: number };
          const ev: Ev[] = [
            ...a.moves.filter((m) => m.status === 'done' && m.kind !== 'wip').map((m) => ({
              date: m.date, kind: m.kindLabel, order: m.kind === 'sale' || m.kind === 'scrap' ? 2 : 0,
              description: [m.partyName, m.voucher ? `سند ${m.voucher.kind === 'receipt' ? 'قبض' : 'صرف'} ${m.voucher.serial}` : null, m.notes].filter(Boolean).join(' · '),
              cost: m.amount, accum: m.accumDelta, dep: 0,
            })),
            ...a.depreciation.filter((d) => d.active).map((d) => ({
              date: d.to, kind: d.kind === 'period' ? 'إهلاك' : 'إهلاك جزئي', order: 1, description: `من ${d.from} إلى ${d.to} (حركة ${d.runNo}${d.entryNo ? `، قيد ${d.entryNo}` : ''})`,
              cost: 0, accum: d.amount, dep: d.amount,
            })),
          ].sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order);
          let c = 0;
          let ac = 0;
          const rows = ev.map((e) => {
            c = r2(c + e.cost);
            ac = r2(ac + e.accum);
            return { date: e.date, kind: e.kind, description: e.description, cost: e.cost, dep: e.dep, costBalance: c, accumBalance: ac, nbv: r2(c - ac) };
          });
          return {
            rows, subtitle: `${a.code} ${a.name} · ${a.groupName} · ${a.effective.methodLabel}${a.effective.lifeYears ? ` · العمر ${r2(a.effective.lifeYears)} سنة` : ''}`,
            summary: [
              { label: 'التكلفة', value: a.cost, type: 'money' }, { label: 'مجمع الإهلاك', value: a.accum, type: 'money' },
              { label: 'صافي القيمة', value: a.nbv, type: 'money' }, { label: 'الحالة', value: a.statusLabel },
            ],
          };
        },
      },
      {
        ...base, code: 'accounting.assets.custody', title: 'العهد لدى الموظفين',
        description: 'الأصول التي في عهدة كل موظف وقيمتها وتاريخ آخر نموذج تسليم وإقرار الاستلام',
        filters: [dynamicFilter('employeeId', 'الموظف', this.employeeOptions)],
        columns: [
          { key: 'employee', label: 'الموظف' }, { key: 'code', label: 'الترميز' }, { key: 'name', label: 'الأصل' }, { key: 'groupName', label: 'المجموعة' },
          { key: 'location', label: 'الموقع' }, { key: 'since', label: 'في عهدته منذ', type: 'date' }, { key: 'confirmed', label: 'أقر بالاستلام', type: 'bool' },
          money('cost', 'التكلفة'), money('nbv', 'صافي القيمة'),
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT e.full_name AS employee, a.code, a.name, g.name AS "groupName", a.location, a.cost::float AS cost, (a.cost - a.accum)::float AS nbv,
                    to_char(c.date, 'YYYY-MM-DD') AS since, c.confirmed_at IS NOT NULL AS confirmed
               FROM acc_assets a JOIN acc_asset_groups g ON g.id = a.group_id JOIN hr_employees e ON e.id = a.custodian_employee_id
               LEFT JOIN LATERAL (SELECT date, confirmed_at FROM acc_asset_custody x WHERE x.asset_id = a.id ORDER BY form_no DESC LIMIT 1) c ON true
              WHERE a.organization_id = $1 AND a.status IN ('draft', 'construction', 'pending_purchase', 'active', 'pending_sale') AND ($2::uuid IS NULL OR a.custodian_employee_id = $2)
              ORDER BY e.full_name, a.asset_no`, [org(u).organizationId, f.employeeId || null]);
          return rows as ReportRow[];
        },
      },
      {
        ...base, code: 'accounting.assets.custody-forms', title: 'سجل نماذج العهد',
        description: 'نماذج تسليم العهد ونقلها واستلامها في الفترة، بحركة الأصل بين الموظفين والمواقع',
        filters: [...periodFilters()],
        columns: [
          { key: 'formNo', label: 'رقم النموذج' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kindLabel', label: 'النوع' }, { key: 'asset', label: 'الأصل' },
          { key: 'fromName', label: 'من' }, { key: 'toName', label: 'إلى' }, { key: 'fromLocation', label: 'من موقع' }, { key: 'toLocation', label: 'إلى موقع' },
          { key: 'condition', label: 'الحالة' }, { key: 'confirmed', label: 'الإقرار', type: 'bool' },
        ],
        run: async (u, f) => (await this.assets.custodyOf(org(u).organizationId, null))
          .filter((c) => c.date >= f.from! && c.date <= f.to!)
          .map((c) => ({ ...c, kindLabel: CUSTODY_AR[c.kind], asset: `${c.assetCode} ${c.assetName}`, confirmed: !!c.confirmedAt })) as unknown as ReportRow[],
      },
      {
        ...base, code: 'accounting.assets.disposals', title: 'الأصول المستبعدة وأرباحها وخسائرها',
        description: 'الأصول المباعة والمخرّدة في الفترة: التكلفة ومجمع الإهلاك وصافي القيمة وقيمة البيع والربح أو الخسارة',
        filters: [...periodFilters(), selectFilter('kind', 'النوع', { sale: 'بيع', scrap: 'تخريد' })],
        orientation: 'landscape',
        columns: [
          { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kindLabel', label: 'النوع' }, { key: 'asset', label: 'الأصل' }, { key: 'groupName', label: 'المجموعة' },
          { key: 'partyName', label: 'المشتري' }, money('cost', 'التكلفة'), money('accum', 'مجمع الإهلاك'), money('nbv', 'صافي القيمة'), money('proceeds', 'قيمة البيع'),
          money('gainLoss', 'الربح (الخسارة)'), { key: 'statusLabel', label: 'الحالة' },
        ],
        run: async (u, f) => (await this.ops.operations(org(u), { kind: f.kind }))
          .filter((o) => (o.kind === 'sale' || o.kind === 'scrap') && o.status !== 'cancelled' && String(o.date) >= f.from! && String(o.date) <= f.to!)
          .map((o) => ({ ...o, asset: `${o.asset.code} ${o.asset.name}`, groupName: o.asset.groupName, cost: o.amount, nbv: r2(o.amount - o.accum) })) as unknown as ReportRow[],
      },
      {
        ...base, code: 'accounting.assets.reconciliation', title: 'مطابقة الأصول مع الدليل المحاسبي',
        description: 'رصيد حساب الأصول وحساب مجمع الإهلاك لكل مجموعة في الدليل مقارنة بسجل الأصول، مع سبب الفرق إن وجد',
        filters: [{ key: 'asOf', label: 'في تاريخ', type: 'date', default: 'today', required: true }],
        columns: [
          { key: 'account', label: 'الحساب' }, { key: 'kindLabel', label: 'النوع' }, { key: 'groups', label: 'المجموعات' }, money('gl', 'رصيد الدليل', false),
          money('subledger', 'سجل الأصول', false), money('diff', 'الفرق', false), { key: 'state', label: 'النتيجة' }, { key: 'problems', label: 'سبب الفرق' },
        ],
        run: async (u, f) => {
          const r = await this.ops.reconcile(org(u), f.asOf);
          return {
            rows: r.accounts.map((x) => ({
              account: `${x.code} ${x.name}`, kindLabel: x.kindLabel, groups: x.groups.join('، '), gl: x.gl, subledger: x.subledger, diff: x.diff,
              state: x.ok ? 'مطابق' : 'غير مطابق', problems: x.problems.join(' | '), _style: x.ok ? undefined : 'strong',
            })),
            summary: [{ label: 'حسابات غير مطابقة', value: r.issues }, { label: 'النتيجة', value: r.ok ? 'كل المجموعات مطابقة' : 'توجد اختلافات' }],
          };
        },
      },
      {
        ...base, code: 'accounting.assets.end-of-life', title: 'الأصول المهلكة بالكامل والقريبة من نهاية عمرها',
        description: 'الأصول التي اكتمل إهلاكها وما زالت في الخدمة، والأصول المتبقي من عمرها سنة أو أقل، لتخطيط الاستبدال',
        filters: [{ ...selectFilter('months', 'المتبقي من العمر', { '0': 'المهلكة بالكامل فقط', '6': '6 أشهر أو أقل', '12': 'سنة أو أقل', '24': 'سنتان أو أقل' }, ''), default: '12', required: true }],
        link: '/accounting/assets/{id}',
        columns: [
          { key: 'code', label: 'الترميز' }, { key: 'name', label: 'الأصل' }, { key: 'groupName', label: 'المجموعة' }, { key: 'inServiceDate', label: 'تاريخ الشراء', type: 'date' },
          { key: 'life', label: 'العمر (سنة)', type: 'number' }, { key: 'remaining', label: 'المتبقي (شهر)', type: 'number' }, money('cost', 'التكلفة'), money('nbv', 'صافي القيمة'),
          { key: 'custodianName', label: 'العهدة لدى' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const list = await this.assets.list(org(u), { status: 'active' });
          const groups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: o } });
          const full = await this.db.getRepository(FixedAsset).find({ where: { organizationId: o, status: 'active' } });
          const limit = Number(f.months ?? 12);
          return list.map((x) => {
            const a = full.find((y) => y.id === x.id)!;
            const g = groups.find((y) => y.id === a.groupId)!;
            const pol = this.assets.policy(a, g);
            const life = pol.life;
            const fully = a.cost > 0 && a.cost - a.accum <= Math.max(a.salvageValue, 1);
            const remaining = life && a.inServiceDate ? Math.max(0, Math.round(life * 12 - monthsEquivalent(a.inServiceDate, today()))) : null;
            return { ...x, life: life ? r2(life) : null, remaining: fully ? 0 : remaining, fully };
          }).filter((x) => x.life && (x.fully || (limit > 0 && x.remaining !== null && x.remaining <= limit))) as unknown as ReportRow[];
        },
      },
      {
        ...base, code: 'accounting.assets.alerts', title: 'التراخيص وعقود الصيانة التي تنتهي',
        description: 'تواريخ الانتهاء في الحقول المرنة (مثل انتهاء ترخيص السيارة) وعقود الصيانة، المنتهية والقريبة من الانتهاء',
        filters: [{ ...selectFilter('days', 'خلال', { '30': '30 يومًا', '60': '60 يومًا', '90': '90 يومًا', '180': '180 يومًا' }, ''), default: '90', required: true }],
        link: '/accounting/assets/{id}',
        columns: [
          { key: 'code', label: 'الترميز' }, { key: 'name', label: 'الأصل' }, { key: 'label', label: 'البند' }, { key: 'date', label: 'تاريخ الانتهاء', type: 'date' },
          { key: 'state', label: 'الحالة' }, { key: 'custodianName', label: 'العهدة لدى' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const assets = await this.db.getRepository(FixedAsset).find({ where: { organizationId: o } });
          const groups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: o } });
          const rows = await this.assets.rows(o, assets.filter((a) => !['sold', 'scrapped'].includes(a.status)));
          return assets.filter((a) => !['sold', 'scrapped'].includes(a.status)).flatMap((a) => this.assets.alerts(a, groups.find((g) => g.id === a.groupId)!, Number(f.days ?? 90)).map((x) => ({
            id: a.id, code: a.code, name: a.name, label: x.label, date: x.date, state: x.expired ? 'منتهٍ' : 'ينتهي قريبًا', custodianName: rows.find((r) => r.id === a.id)?.custodianName ?? null,
          }))).sort((x, y) => x.date.localeCompare(y.date)) as ReportRow[];
        },
      },
      {
        ...base, code: 'accounting.assets.by-unit', title: 'توزيع الأصول حسب الجهة المسؤولة والموقع',
        description: 'عدد الأصول وقيمتها لكل جهة مسؤولة (من هيكل الموارد البشرية) ولكل موقع',
        filters: [{ ...selectFilter('by', 'التوزيع حسب', { unit: 'الجهة المسؤولة', location: 'الموقع', group: 'المجموعة' }, ''), default: 'unit', required: true }],
        columns: [{ key: 'label', label: 'البند' }, { key: 'count', label: 'عدد الأصول', type: 'number', total: true }, money('cost', 'التكلفة'), money('accum', 'مجمع الإهلاك'), money('nbv', 'صافي القيمة'), { key: 'share', label: 'النسبة من القيمة', type: 'percent' }],
        run: async (u, f) => {
          const list = await this.assets.list(org(u), { status: 'books' });
          const key = (x: (typeof list)[number]) => (f.by === 'location' ? x.location : f.by === 'group' ? x.groupName : x.unitName) ?? 'غير محدد';
          const map = new Map<string, { count: number; cost: number; accum: number; nbv: number }>();
          for (const x of list) {
            const v = map.get(key(x)) ?? { count: 0, cost: 0, accum: 0, nbv: 0 };
            map.set(key(x), { count: v.count + 1, cost: v.cost + x.cost, accum: v.accum + x.accum, nbv: v.nbv + x.nbv });
          }
          const total = [...map.values()].reduce((s, v) => s + v.nbv, 0);
          return [...map.entries()].map(([label, v]) => ({ label, count: v.count, cost: r2(v.cost), accum: r2(v.accum), nbv: r2(v.nbv), share: total ? r2((v.nbv / total) * 100) : 0 }))
            .sort((a, b) => b.nbv - a.nbv);
        },
      },
      {
        ...base, code: 'accounting.assets.forecast', title: 'توقع الإهلاك للأشهر القادمة',
        description: 'الإهلاك المتوقع لكل مجموعة في الأشهر الاثني عشر القادمة على الأصول الحالية، للموازنة التقديرية',
        filters: [], orientation: 'landscape',
        columns: [{ key: 'groupName', label: 'المجموعة' }],
        run: async (u) => {
          const o = org(u).organizationId;
          const assets = await this.db.getRepository(FixedAsset).find({ where: { organizationId: o, status: 'active' } });
          const groups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: o } });
          const ids = new Set(assets.map((a) => a.id));
          const movesOf = byAsset(ids.size ? await this.db.getRepository(AssetMove).find({ where: { organizationId: o, status: 'done' } }) : [], ids);
          const linesOf = byAsset(ids.size ? await this.db.getRepository(DepLine).find({ where: { organizationId: o, active: true } }) : [], ids);
          const groupById = new Map(groups.map((g) => [g.id, g]));
          const cfg = await this.assets.config(o);
          const start = monthStart(today());
          const months: string[] = [];
          for (let i = 0, d = start; i < 12; i++, d = addDays(monthEnd(d), 1)) months.push(d.slice(0, 7));
          const horizon = monthEnd(`${months[11]}-01`);
          const totals = new Map<string, Map<string, number>>();
          for (const a of assets) {
            if (!a.inServiceDate) continue;
            const g = groupById.get(a.groupId)!;
            const pol = this.assets.policy(a, g);
            const mv = movesOf.get(a.id) ?? [];
            const res = computeDepreciation({
              inServiceDate: a.inServiceDate, depreciatedThrough: a.depreciatedThrough, salvage: a.salvageValue, method: pol.method, rate: pol.rate, lifeYears: pol.lifeYears,
              costMoves: mv.filter((m) => ['opening', 'purchase', 'donation', 'addition'].includes(m.kind)).map((m) => ({ date: m.date, amount: m.amount })),
              accum: a.accum, accumHistory: [...mv.filter((m) => m.kind === 'opening').map((m) => ({ date: m.date, amount: m.accumDelta })), ...(linesOf.get(a.id) ?? []).map((l) => ({ date: l.toDate, amount: l.amount }))],
              yearStartOf: (m) => `${m.slice(0, 4)}-01-01`, partial: cfg.partialMonth,
            }, horizon);
            const gm = totals.get(g.id) ?? new Map<string, number>();
            for (const m of res.months) {
              const key = m.month < months[0] ? months[0] : m.month;
              gm.set(key, (gm.get(key) ?? 0) + m.amount);
            }
            totals.set(g.id, gm);
          }
          const rows = groups.filter((g) => totals.has(g.id)).map((g) => {
            const gm = totals.get(g.id)!;
            const row: ReportRow = { groupName: g.name };
            months.forEach((m, i) => { row[`m${i}`] = r2(gm.get(m) ?? 0); });
            row.total = r2([...gm.values()].reduce((s, v) => s + v, 0));
            return row;
          });
          return {
            rows,
            columns: [{ key: 'groupName', label: 'المجموعة' }, ...months.map((m, i) => ({ key: `m${i}`, label: `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`, type: 'money' as const, total: true })), { key: 'total', label: 'الإجمالي', type: 'money' as const, total: true }],
            notes: ['الشهر الأول يشمل أي إهلاك متأخر لم يُحتسب بعد. التوقع على الأصول الحالية دون مشتريات أو استبعادات جديدة.'],
          };
        },
      },
      {
        ...base, code: 'accounting.assets.stocktake', title: 'فروقات الجرد الدوري',
        description: 'نتيجة آخر جرد أو جرد محدد: الأصول المفقودة، والموجودة في غير موقعها، والأصول التي وُجدت خارج نطاق الجرد',
        filters: [dynamicFilter('stocktakeId', 'الجرد', async (u) => (await this.db.query(`SELECT id AS value, '#' || stocktake_no || ' ' || title AS label FROM acc_asset_stocktakes WHERE organization_id = $1 ORDER BY stocktake_no DESC`, [u.organizationId])) as { value: string; label: string }[], 'آخر جرد')],
        columns: [{ key: 'code', label: 'الترميز' }, { key: 'name', label: 'الأصل' }, { key: 'variance', label: 'الفرق' }, { key: 'expected', label: 'المتوقع' }, { key: 'found', label: 'الموجود' }, { key: 'notes', label: 'ملاحظات' }],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const [s] = await this.db.query(`SELECT id FROM acc_asset_stocktakes WHERE organization_id = $1 AND ($2::uuid IS NULL OR id = $2) ORDER BY stocktake_no DESC LIMIT 1`, [o, f.stocktakeId || null]);
          if (!s) return [];
          const st = await this.assets.stocktake(org(u), s.id);
          const rows: ReportRow[] = [];
          for (const l of st.lines ?? []) {
            if (l.result === 'missing' || l.result === 'pending') rows.push({ code: l.code, name: l.name, variance: l.result === 'missing' ? 'مفقود' : 'لم يُجرد بعد', expected: [l.expectedLocation, l.expectedCustodian].filter(Boolean).join(' · '), found: '', notes: l.notes });
            else if (l.foundLocation && l.expectedLocation && l.foundLocation !== l.expectedLocation) rows.push({ code: l.code, name: l.name, variance: 'في غير موقعه', expected: l.expectedLocation, found: l.foundLocation, notes: l.notes });
            else if (l.condition && !['جيد', 'جديد', 'ممتاز'].includes(l.condition)) rows.push({ code: l.code, name: l.name, variance: `حالته: ${l.condition}`, expected: l.expectedLocation, found: l.foundLocation, notes: l.notes });
          }
          for (const x of st.extras ?? []) rows.push({ code: x.code, name: '', variance: 'وُجد خارج نطاق الجرد', expected: '', found: '', notes: x.note });
          return {
            rows, subtitle: `جرد رقم ${st.stocktakeNo}: ${st.title} (${st.date}) · ${st.status === 'open' ? 'مفتوح' : 'مغلق'}`,
            summary: [{ label: 'أصول النطاق', value: st.counts.total }, { label: 'موجود', value: st.counts.found }, { label: 'مفقود', value: st.counts.missing }, { label: 'لم يُجرد', value: st.counts.pending }],
          };
        },
      },
      {
        ...base, code: 'accounting.assets.operations', title: 'سجل عمليات الأصول',
        description: 'الشراء والإضافات والتبرعات العينية والبيع والتخريد في الفترة، بسنداتها وحالة اعتمادها',
        filters: [...periodFilters(), selectFilter('kind', 'العملية', MOVE_AR)],
        orientation: 'landscape',
        columns: [
          { key: 'moveNo', label: 'الرقم' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kindLabel', label: 'العملية' }, { key: 'asset', label: 'الأصل' },
          { key: 'partyName', label: 'الطرف' }, { key: 'methodLabel', label: 'السداد' }, money('amount', 'المبلغ'), { key: 'document', label: 'المستند' }, { key: 'statusLabel', label: 'الحالة' },
        ],
        run: async (u, f) => (await this.ops.operations(org(u), { kind: f.kind }))
          .filter((o) => String(o.date) >= f.from! && String(o.date) <= f.to!)
          .map((o) => ({
            ...o, asset: `${o.asset.code} ${o.asset.name}`, amount: o.kind === 'sale' ? o.proceeds : o.amount,
            document: o.voucher ? `سند ${o.voucher.kind === 'receipt' ? 'قبض' : 'صرف'} ${o.voucher.serial}` : o.entry ? `سند أصول ${o.entry.voucherNo}` : '',
          })) as unknown as ReportRow[],
      },
      {
        ...base, code: 'accounting.assets.insurance', title: 'التأمين والضمان على الأصول',
        description: 'الأصول التي تتطلب تأمينًا أو لها ضمان: الجهة ورقم الوثيقة وتاريخ الانتهاء وحالتها (سارية، تنتهي قريبًا، منتهية، غير مسجلة)',
        filters: [{ ...selectFilter('kind', 'العرض', { insurance: 'التأمين', warranty: 'الضمان' }, 'التأمين والضمان') }, selectFilter('state', 'الحالة', { missing: 'غير مسجلة', expired: 'منتهية', soon: 'تنتهي قريبًا', valid: 'سارية' })],
        orientation: 'landscape', link: '/accounting/assets/{assetId}',
        columns: [
          { key: 'code', label: 'الترميز' }, { key: 'name', label: 'الأصل' }, { key: 'groupName', label: 'المجموعة' }, { key: 'kindLabel', label: 'النوع' },
          { key: 'provider', label: 'الجهة' }, { key: 'ref', label: 'رقم الوثيقة' }, { key: 'startDate', label: 'من', type: 'date' }, { key: 'endDate', label: 'إلى', type: 'date' },
          money('cost', 'القسط'), money('coverage', 'مبلغ التغطية'), money('nbv', 'صافي قيمة الأصل'), { key: 'stateLabel', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const cfg = await this.assets.config(o);
          const t = today();
          const soon = addDays(t, cfg.alertDays);
          const assets = await this.db.getRepository(FixedAsset).find({ where: { organizationId: o }, order: { assetNo: 'ASC' } });
          const groups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: o } });
          const st = (end: string | null) => (!end ? 'missing' : end < t ? 'expired' : end <= soon ? 'soon' : 'valid');
          const STATE: Record<string, string> = { missing: 'غير مسجلة', expired: 'منتهية', soon: 'تنتهي قريبًا', valid: 'سارية' };
          const out: ReportRow[] = [];
          for (const a of assets.filter((x) => !['sold', 'scrapped', 'draft'].includes(x.status))) {
            const base1 = { assetId: a.id, code: a.code, name: a.name, groupName: groups.find((g) => g.id === a.groupId)?.name ?? '', nbv: r2(a.cost - a.accum) };
            if (a.insuranceRequired && f.kind !== 'warranty') {
              const s1 = st(a.insurance?.endDate ?? null);
              out.push({ ...base1, kindLabel: 'تأمين', provider: a.insurance?.provider ?? '', ref: a.insurance?.policyNo ?? '', startDate: a.insurance?.startDate ?? null, endDate: a.insurance?.endDate ?? null,
                cost: a.insurance?.cost ?? 0, coverage: a.insurance?.coverage ?? 0, state: s1, stateLabel: STATE[s1], _style: s1 === 'missing' || s1 === 'expired' ? 'strong' : undefined });
            }
            if (a.warrantyRequired && f.kind !== 'insurance') {
              const s1 = st(a.warranty?.endDate ?? null);
              out.push({ ...base1, kindLabel: 'ضمان', provider: a.warranty?.provider ?? '', ref: '', startDate: a.warranty?.startDate ?? null, endDate: a.warranty?.endDate ?? null,
                cost: 0, coverage: 0, state: s1, stateLabel: STATE[s1] });
            }
          }
          return out.filter((r) => !f.state || r.state === f.state);
        },
      },
      {
        ...base, code: 'accounting.assets.maintenance', title: 'سجل الصيانة وتكاليفها',
        description: 'كل أعمال الصيانة الوقائية وإصلاح الأعطال في الفترة: الأصل والجهة المنفذة والتكلفة وأيام التوقف وسند الصرف',
        filters: [...periodFilters(), selectFilter('kind', 'النوع', MAINT_AR), dynamicFilter('assetId', 'الأصل', this.assetOptions)],
        orientation: 'landscape', link: '/accounting/assets/{assetId}',
        columns: [
          { key: 'recordNo', label: 'الرقم' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kindLabel', label: 'النوع' }, { key: 'asset', label: 'الأصل' },
          { key: 'groupName', label: 'المجموعة' }, { key: 'description', label: 'البيان' }, { key: 'vendor', label: 'الجهة المنفذة' },
          { key: 'downtimeDays', label: 'أيام التوقف', type: 'number', total: true }, money('cost', 'التكلفة'), { key: 'voucher', label: 'سند الصرف' },
        ],
        run: async (u, f) => (await this.maint.list(org(u), { kind: f.kind, assetId: f.assetId, from: f.from, to: f.to })).map((r) => ({
          ...r, assetId: r.asset.id, asset: `${r.asset.code} ${r.asset.name}`, groupName: r.asset.groupName, voucher: r.voucher ? `صرف ${r.voucher.serial}` : 'مسجلة للمتابعة',
        })) as unknown as ReportRow[],
      },
      {
        ...base, code: 'accounting.assets.failures', title: 'الأصول كثيرة الأعطال',
        description: `عدد الأعطال وتكلفة الصيانة ونسبتها من تكلفة الأصل وأيام التوقف لكل أصل. يُعلَّم الأصل إن تكررت أعطاله 3 مرات أو بلغت صيانته 30% من تكلفته`,
        filters: [...periodFilters(), dynamicFilter('groupId', 'المجموعة', this.groupOptions)],
        orientation: 'landscape', link: '/accounting/assets/{assetId}',
        columns: [
          { key: 'code', label: 'الترميز' }, { key: 'name', label: 'الأصل' }, { key: 'groupName', label: 'المجموعة' }, { key: 'repairs', label: 'الأعطال', type: 'number', total: true },
          { key: 'preventive', label: 'صيانة وقائية', type: 'number', total: true }, money('repairCost', 'تكلفة الإصلاح'), money('maintenanceCost', 'إجمالي الصيانة'),
          money('cost', 'تكلفة الأصل'), { key: 'ratio', label: 'النسبة %', type: 'number' }, { key: 'downtimeDays', label: 'أيام التوقف', type: 'number', total: true },
          { key: 'advice', label: 'التوصية' },
        ],
        run: async (u, f) => (await this.maint.failures(org(u), { from: f.from, to: f.to, groupId: f.groupId })).rows
          .map((r) => ({ ...r, _style: r.frequent ? 'strong' : undefined })) as unknown as ReportRow[],
      },
      {
        ...base, code: 'accounting.assets.revaluations', title: 'إعادة التقييم وهبوط القيمة',
        description: 'عمليات إعادة التقييم (زيادة القيمة مقابل فائض إعادة التقييم) وهبوط القيمة (خسارة تُضاف لمجمع الإهلاك) في الفترة',
        filters: [...periodFilters(), selectFilter('kind', 'النوع', { revaluation: 'إعادة تقييم', impairment: 'هبوط قيمة' })],
        orientation: 'landscape', link: '/accounting/assets/{assetId}',
        columns: [
          { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kindLabel', label: 'النوع' }, { key: 'asset', label: 'الأصل' }, { key: 'groupName', label: 'المجموعة' },
          money('newValue', 'القيمة العادلة / القابلة للاسترداد', false), money('increase', 'الزيادة'), money('loss', 'الخسارة'), { key: 'partyName', label: 'المقيّم / السبب' },
          { key: 'document', label: 'سند الأصول' }, { key: 'statusLabel', label: 'الحالة' },
        ],
        run: async (u, f) => (await this.ops.operations(org(u), { kind: f.kind }))
          .filter((o) => (o.kind === 'revaluation' || o.kind === 'impairment') && String(o.date) >= f.from! && String(o.date) <= f.to!)
          .map((o) => ({
            ...o, assetId: o.asset.id, asset: `${o.asset.code} ${o.asset.name}`, groupName: o.asset.groupName, newValue: o.proceeds,
            increase: o.kind === 'revaluation' && o.status !== 'cancelled' ? o.amount : 0, loss: o.kind === 'impairment' && o.status !== 'cancelled' ? Math.abs(o.gainLoss) : 0,
            partyName: o.kind === 'revaluation' ? o.partyName : o.notes, document: o.entry ? o.entry.voucherNo : '',
          })) as unknown as ReportRow[],
      },
      {
        ...base, code: 'accounting.assets.wip', title: 'الأصول تحت التنفيذ',
        description: 'لكل أصل تحت التنفيذ أو رُسمل في الفترة: الدفعات المعتمدة والمعلقة، وتاريخ الرسملة وقيمتها، والرصيد في حساب المشروعات تحت التنفيذ',
        filters: [{ ...selectFilter('state', 'العرض', { open: 'تحت التنفيذ حاليًا', done: 'المرسملة' }, 'الكل') }],
        orientation: 'landscape', link: '/accounting/assets/{assetId}',
        columns: [
          { key: 'code', label: 'الترميز' }, { key: 'name', label: 'الأصل' }, { key: 'groupName', label: 'المجموعة' }, { key: 'payments', label: 'الدفعات', type: 'number' },
          { key: 'firstDate', label: 'أول دفعة', type: 'date' }, money('paid', 'المعتمد'), money('pending', 'ينتظر الاعتماد'), { key: 'capitalizedAt', label: 'تاريخ الرسملة', type: 'date' },
          money('capitalized', 'المرسمل'), money('balance', 'رصيد تحت التنفيذ'),
        ],
        run: async (u, f) => {
          const rows: Record<string, string | number | null>[] = await this.db.query(
            `SELECT a.id, a.code, a.name, g.name AS group_name, COUNT(*) FILTER (WHERE m.kind = 'wip')::int AS payments, to_char(MIN(m.date) FILTER (WHERE m.kind = 'wip'), 'YYYY-MM-DD') AS first_date,
                    COALESCE(SUM(m.amount) FILTER (WHERE m.kind = 'wip' AND m.status = 'done'), 0) AS paid, COALESCE(SUM(m.amount) FILTER (WHERE m.kind = 'wip' AND m.status = 'pending'), 0) AS pending,
                    to_char(MAX(m.date) FILTER (WHERE m.kind = 'capitalize' AND m.status = 'done'), 'YYYY-MM-DD') AS cap_date,
                    COALESCE(SUM(m.amount) FILTER (WHERE m.kind = 'capitalize' AND m.status = 'done'), 0) AS capitalized
               FROM acc_assets a JOIN acc_asset_groups g ON g.id = a.group_id JOIN acc_asset_moves m ON m.asset_id = a.id AND m.status <> 'cancelled' AND m.kind IN ('wip', 'capitalize')
              WHERE a.organization_id = $1 GROUP BY a.id, g.name ORDER BY a.asset_no`, [org(u).organizationId]);
          return rows.map((r) => ({
            assetId: r.id, code: r.code, name: r.name, groupName: r.group_name, payments: r.payments, firstDate: r.first_date, paid: Number(r.paid), pending: Number(r.pending),
            capitalizedAt: r.cap_date, capitalized: Number(r.capitalized), balance: r2(Number(r.paid) - Number(r.capitalized)),
          })).filter((r) => !f.state || (f.state === 'open' ? !r.capitalizedAt : !!r.capitalizedAt));
        },
      },
      {
        ...base, code: 'accounting.assets.funded', title: 'الأصول الممولة من منح ومشاريع',
        description: 'مشتريات الأصول الممولة من منحة أو مشروع: المبلغ الممول وقيد تخفيض صافي الأصول المقيدة الصادر عند اعتماد الشراء',
        filters: [...periodFilters()],
        orientation: 'landscape', link: '/accounting/assets/{assetId}',
        columns: [
          { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kindLabel', label: 'العملية' }, { key: 'asset', label: 'الأصل' }, { key: 'fundingName', label: 'المنحة / المشروع' },
          money('amount', 'مبلغ الشراء'), money('funded', 'الممول من المنحة'), { key: 'release', label: 'قيد تحرير القيد' }, { key: 'statusLabel', label: 'الحالة' },
        ],
        run: async (u, f) => (await this.ops.operations(org(u), {}))
          .filter((o) => o.funding && String(o.date) >= f.from! && String(o.date) <= f.to!)
          .map((o) => ({
            ...o, assetId: o.asset.id, asset: `${o.asset.code} ${o.asset.name}`, fundingName: o.funding!.name, funded: o.status === 'cancelled' ? 0 : o.funding!.amount,
            release: o.funding!.entry ? `قيد ${o.funding!.entry.entryNo}${o.funding!.entry.status === 'cancelled' ? ' (ملغي)' : ''}` : 'يصدر عند اعتماد السند',
          })) as unknown as ReportRow[],
      },
      {
        ...base, code: 'accounting.assets.capital-budget', title: 'الموازنة الرأسمالية: المخطط والفعلي',
        description: 'لكل بند في الموازنة الرأسمالية: المخطط والملتزم به (سندات تنتظر الاعتماد) والفعلي والمتبقي ونسبة التنفيذ، ثم الإنفاق غير المدرج في الموازنة',
        filters: [dynamicFilter('budgetId', 'الموازنة', async (u) => (await this.db.query(
          `SELECT b.id AS value, b.title || ' (' || y.name || ')' AS label FROM acc_asset_budgets b JOIN acc_fiscal_years y ON y.id = b.fiscal_year_id WHERE b.organization_id = $1 ORDER BY y.start_date DESC`,
          [u.organizationId])) as { value: string; label: string }[], 'أحدث موازنة')],
        orientation: 'landscape', indentColumn: 'description',
        columns: [
          { key: 'description', label: 'البند' }, { key: 'groupName', label: 'المجموعة' }, { key: 'quarter', label: 'الربع' }, money('amount', 'المخطط'), money('committed', 'ملتزم به'),
          money('actual', 'الفعلي'), money('remaining', 'المتبقي'), { key: 'usedPct', label: 'التنفيذ %', type: 'number' }, { key: 'externalRef', label: 'مرجع الخطة' },
        ],
        run: async (u, f) => {
          const list = await this.budget.list(org(u));
          const id = f.budgetId || (list[0]?.id as string | undefined);
          if (!id) return [];
          const b = await this.budget.get(org(u), id);
          const rows: ReportRow[] = b.lines.map((l) => ({ ...l, quarter: l.quarter ? `ر${l.quarter}` : '', _style: l.over ? 'strong' as const : undefined }));
          if (b.unbudgeted.length) {
            rows.push({ description: 'إنفاق رأسمالي غير مدرج في الموازنة', _style: 'group', _skipTotal: true });
            for (const m of b.unbudgeted) {
              rows.push({ description: `${m.kindLabel}: ${m.asset.code} ${m.asset.name}`, groupName: m.groupName, _level: 2, _skipTotal: true, amount: 0,
                committed: m.status === 'pending' ? m.amount : 0, actual: m.status === 'done' ? m.amount : 0, remaining: null });
            }
          }
          return {
            rows, subtitle: `${b.title} · ${b.statusLabel}`,
            summary: [
              { label: 'المخطط', value: b.planned, type: 'money' }, { label: 'الفعلي', value: b.actual, type: 'money' },
              { label: 'ملتزم به', value: b.committed, type: 'money' }, { label: 'غير مدرج في الموازنة', value: b.unbudgetedTotal, type: 'money' },
            ],
          };
        },
      },
      {
        ...base, code: 'accounting.assets.methods', title: 'سياسات الإهلاك المطبقة',
        description: 'طريقة الإهلاك ونسبته والعمر الإنتاجي والحسابات المرتبطة لكل مجموعة، للإفصاح في القوائم المالية',
        filters: [],
        columns: [
          { key: 'name', label: 'المجموعة' }, { key: 'methodLabel', label: 'الطريقة' }, { key: 'rate', label: 'النسبة %', type: 'number' }, { key: 'life', label: 'العمر (سنة)', type: 'number' },
          { key: 'assetAccount', label: 'حساب الأصل' }, { key: 'accumAccount', label: 'مجمع الإهلاك' }, { key: 'expenseAccount', label: 'مصروف الإهلاك' }, { key: 'assets', label: 'عدد الأصول', type: 'number', total: true },
        ],
        run: async (u) => (await this.assets.listGroups(org(u))).map((g) => ({
          name: g.name, methodLabel: g.depreciable ? DEP_METHOD_AR[g.method] : 'لا يُهلك', rate: g.rate, life: g.lifeYears ? r2(Number(g.lifeYears)) : lifeOf(g.rate, null),
          assetAccount: g.assetAccount ? `${g.assetAccount.code} ${g.assetAccount.name}` : '', accumAccount: g.accumAccount ? `${g.accumAccount.code} ${g.accumAccount.name}` : '—',
          expenseAccount: g.expenseAccount ? `${g.expenseAccount.code} ${g.expenseAccount.name}` : '—', assets: g.inBooks,
        })),
      },
    ];
    this.registry.register(defs);
    void ar;
  }
}
