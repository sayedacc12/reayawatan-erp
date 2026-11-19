import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AccountRule, computePerformance, EMPTY_FIGURES, FIGURES, FinFigureKey, FinFigures, FINANCIAL_PERFORMANCE, PerformanceResult,
} from './catalog';
import { GovSettings } from './entities/governance.entity';

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** تاريخ اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
};
export const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoDay(d);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const monthEnd = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};

/** net بالهللات */
interface DailyNet { code: string; name: string; day: string; opening: boolean; net: number }

export interface FiscalYearInfo { id: string; name: number; startDate: string; endDate: string; status: string }

export interface FinanceSnapshot {
  year: FiscalYearInfo;
  from: string;
  to: string;
  /** نسبة ما مضى من السنة المالية */
  elapsed: number;
  figures: FinFigures;
  /** الأرقام بعد تحويل الحركة الجزئية إلى سنة كاملة (للتنبؤ) */
  annualized: FinFigures;
  /** النتيجة على الأرقام كما هي (تطابق التقييم الرسمي عند اكتمال السنة) */
  actual: PerformanceResult;
  /** النتيجة المتوقعة لنهاية السنة على الحركة المحوّلة لسنة كاملة */
  forecast: PerformanceResult;
  /** تفصيل كل رقم: الحسابات المستخدمة ومبلغ كل منها */
  breakdown: Record<FinFigureKey, { code: string; name: string; amount: number }[]>;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * الربط مع النظام المالي: يستخرج أرقام مؤشرات الأداء المالي من القيود المرحّلة على دليل الحسابات الموحد.
 * - أرقام الحركة (المصروفات والإيرادات والتبرعات) = حركة الفترة دون القيد الافتتاحي.
 * - أرقام الأرصدة (النقد والاستثمارات والالتزامات وصافي الأصول) = الرصيد حتى نهاية الفترة شاملاً الافتتاحي.
 * يقرأ جداول المحاسبة فقط ولا يكتب فيها.
 */
@Injectable()
export class GovFinance {
  constructor(private readonly db: DataSource) {}

  async settings(org: string): Promise<GovSettings> {
    const repo = this.db.getRepository(GovSettings);
    const s = await repo.findOne({ where: { organizationId: org } });
    if (s) return s;
    await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
    return repo.findOneOrFail({ where: { organizationId: org } });
  }

  /** ربط الأرقام بالحسابات: تعديلات الجمعية فوق الربط الافتراضي من الدليل */
  mappingOf(s: Pick<GovSettings, 'mapping'>): Record<FinFigureKey, AccountRule[]> {
    return Object.fromEntries(FIGURES.map((f) => [f.key, s.mapping?.[f.key] ?? f.accounts])) as Record<FinFigureKey, AccountRule[]>;
  }

  async ready(org: string) {
    const [r] = await this.db.query(
      `SELECT (SELECT chart_installed_at IS NOT NULL FROM acc_settings WHERE organization_id = $1) AS chart,
              (SELECT COUNT(*)::int FROM acc_fiscal_years WHERE organization_id = $1) AS years`, [org]);
    return { chart: !!r?.chart, years: r?.years ?? 0 };
  }

  async years(org: string): Promise<FiscalYearInfo[]> {
    const rows = await this.db.query(
      `SELECT id, name, to_char(start_date, 'YYYY-MM-DD') AS start, to_char(end_date, 'YYYY-MM-DD') AS "end", status
         FROM acc_fiscal_years WHERE organization_id = $1 ORDER BY start_date`, [org]);
    return rows.map((y: { id: string; name: number; start: string; end: string; status: string }) => ({ id: y.id, name: y.name, startDate: y.start, endDate: y.end, status: y.status }));
  }

  /** السنة المالية التي تحتوي التاريخ؛ وبدون strict: آخر سنة إن كان التاريخ بعدها */
  async yearOf(org: string, date: string, strict = false): Promise<FiscalYearInfo | null> {
    const ys = await this.years(org);
    if (strict) return ys.find((y) => y.startDate <= date && y.endDate >= date) ?? null;
    return ys.find((y) => y.startDate <= date && y.endDate >= date) ?? (date > (ys.at(-1)?.endDate ?? '') ? ys.at(-1) ?? null : ys[0] ?? null);
  }

  /**
   * صافي الحركة لكل حساب ولكل يوم من بداية السنة حتى تاريخ معيّن، في استعلام واحد.
   * منه تُحسب أرقام أي فترة تبدأ من أول السنة (اللقطة والسلسلة الشهرية) دون إعادة مسح القيود لكل شهر.
   * تُحفظ النتيجة 60 ثانية لأن اللوحة والتنبيهات تطلبها معًا في الطلب نفسه.
   */
  private readonly dailyCache = new Map<string, { at: number; rows: Promise<DailyNet[]> }>();

  private dailyNets(org: string, year: FiscalYearInfo, to: string): Promise<DailyNet[]> {
    const key = `${org}|${year.id}|${to}`;
    const hit = this.dailyCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.rows;
    const rows = this.db
      .query(
        `SELECT a.code, a.name, to_char(e.document_date, 'YYYY-MM-DD') AS day, (e.voucher_type = 'opening') AS opening, SUM(l.debit - l.credit) AS net
           FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_accounts a ON a.id = l.account_id
          WHERE e.organization_id = $1 AND e.fiscal_year_id = $2 AND e.status = 'posted' AND e.document_date <= $3
          GROUP BY a.code, a.name, e.document_date, e.voucher_type = 'opening'`,
        [org, year.id, to],
      )
      .then((r: { code: string; name: string; day: string; opening: boolean; net: string }[]) => r.map((x) => ({ ...x, net: Math.round(Number(x.net) * 100) })));
    rows.catch(() => this.dailyCache.delete(key));
    for (const [k, v] of this.dailyCache) if (Date.now() - v.at >= 60_000) this.dailyCache.delete(k);
    this.dailyCache.set(key, { at: Date.now(), rows });
    return rows;
  }

  /** نفس نتيجة nets() لفترة تبدأ من أول السنة، محسوبة من الحركة اليومية */
  private netsFromDaily(daily: DailyNet[], end: string) {
    const acc = new Map<string, { code: string; name: string; flow: number; bal: number }>();
    for (const d of daily) {
      if (d.day > end) continue;
      const n = acc.get(d.code) ?? { code: d.code, name: d.name, flow: 0, bal: 0 };
      n.bal += d.net;
      if (!d.opening) n.flow += d.net;
      acc.set(d.code, n);
    }
    // الجمع بالهللات لتفادي أخطاء الكسور، ثم التحويل للريال
    return [...acc.values()].map((n) => ({ ...n, flow: n.flow / 100, bal: n.bal / 100 })).sort((a, b) => (a.code < b.code ? -1 : 1));
  }

  /** صافي الحركة (مدين − دائن) لكل حساب ترحيل في الفترة */
  private async nets(org: string, year: FiscalYearInfo, from: string, to: string) {
    const rows: { code: string; name: string; flow: string; bal: string }[] = await this.db.query(
      `SELECT a.code, a.name,
              COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.voucher_type <> 'opening' AND e.document_date >= $3), 0) AS flow,
              COALESCE(SUM(l.debit - l.credit), 0) AS bal
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_accounts a ON a.id = l.account_id
        WHERE e.organization_id = $1 AND e.fiscal_year_id = $2 AND e.status = 'posted' AND e.document_date <= $4
        GROUP BY a.code, a.name ORDER BY a.code`, [org, year.id, from, to]);
    return rows.map((r) => ({ code: r.code, name: r.name, flow: Number(r.flow), bal: Number(r.bal) }));
  }

  private apply(nets: { code: string; name: string; flow: number; bal: number }[], mapping: Record<FinFigureKey, AccountRule[]>) {
    const figures = EMPTY_FIGURES();
    const breakdown = {} as FinanceSnapshot['breakdown'];
    for (const def of FIGURES) {
      const rules = mapping[def.key] ?? [];
      const parts = new Map<string, { code: string; name: string; amount: number }>();
      let total = 0;
      for (const n of nets) {
        const raw = def.kind === 'flow' ? n.flow : n.bal;
        const v = def.side === 'debit' ? raw : -raw;
        let mult = 0;
        for (const r of rules) if (n.code.startsWith(r.code)) mult += r.sign ?? 1;
        if (!mult || !v) continue;
        total += v * mult;
        const p = parts.get(n.code) ?? { code: n.code, name: n.name, amount: 0 };
        p.amount = r2(p.amount + v * mult);
        parts.set(n.code, p);
      }
      figures[def.key] = r2(total);
      breakdown[def.key] = [...parts.values()].filter((p) => p.amount !== 0);
    }
    return { figures, breakdown };
  }

  /** أرقام الفترة من القيود المرحّلة */
  async figures(org: string, from: string, to: string, settings?: GovSettings) {
    const s = settings ?? await this.settings(org);
    const year = await this.yearOf(org, to, true);
    if (!year) return null;
    const f = from < year.startDate ? year.startDate : from;
    const t = to > year.endDate ? year.endDate : to;
    const nets = f === year.startDate ? this.netsFromDaily(await this.dailyNets(org, year, t), t) : await this.nets(org, year, f, t);
    const { figures, breakdown } = this.apply(nets, this.mappingOf(s));
    return { year, from: f, to: t, figures, breakdown };
  }

  /** تحويل حركة جزء من السنة إلى سنة كاملة (أرقام الأرصدة تبقى كما هي) */
  annualize(f: FinFigures, from: string, to: string, year: FiscalYearInfo): { figures: FinFigures; elapsed: number } {
    const total = daysBetween(year.startDate, year.endDate) + 1;
    const span = Math.max(1, daysBetween(from, to) + 1);
    const factor = total / span;
    const out = { ...f };
    for (const def of FIGURES) if (def.kind === 'flow') out[def.key] = r2(f[def.key] * factor);
    return { figures: out, elapsed: Math.min(1, span / total) };
  }

  /** لقطة كاملة: الفعلي حتى تاريخه والتنبؤ بنهاية السنة */
  async snapshot(org: string, to: string, factor = 1): Promise<FinanceSnapshot | null> {
    const year = await this.yearOf(org, to);
    if (!year) return null;
    const res = await this.figures(org, year.startDate, to);
    if (!res) return null;
    const { figures: annualized, elapsed } = this.annualize(res.figures, res.from, res.to, year);
    return {
      year, from: res.from, to: res.to, elapsed: r2(elapsed * 100), figures: res.figures, annualized, breakdown: res.breakdown,
      actual: computePerformance(res.figures, factor), forecast: computePerformance(annualized, factor),
    };
  }

  /**
   * سلسلة شهرية: درجة الأداء المالي في نهاية كل شهر من السنة (تراكمي من بدايتها، محوّلاً لسنة كاملة)،
   * ثم اتجاه خطي يُسقط على نهاية السنة. هذه أساس «التقييم التنبؤي الفتري».
   */
  async series(org: string, to: string) {
    const year = await this.yearOf(org, to);
    if (!year) return null;
    const s = await this.settings(org);
    const mapping = this.mappingOf(s);
    const points: { month: string; to: string; score: number; indicators: Record<string, number>; subs: Record<string, number | null> }[] = [];
    let m = year.startDate;
    const last = to > year.endDate ? year.endDate : to;
    const daily = await this.dailyNets(org, year, last);
    while (m <= last) {
      const end = monthEnd(m) > last ? last : monthEnd(m);
      const { figures } = this.apply(this.netsFromDaily(daily, end), mapping);
      const { figures: ann } = this.annualize(figures, year.startDate, end, year);
      const r = computePerformance(ann);
      points.push({
        month: end.slice(0, 7), to: end, score: r.score,
        indicators: Object.fromEntries(r.indicators.map((i) => [i.code, i.score])),
        subs: Object.fromEntries(r.indicators.flatMap((i) => i.subs.map((x) => [x.code, x.ratio]))),
      });
      m = addMonths(`${m.slice(0, 7)}-01`, 1);
    }
    const trend = linearTrend(points.map((p) => p.score));
    const monthsLeft = Math.max(0, Math.round(daysBetween(last, year.endDate) / 30.4));
    const projected = points.length ? clampScore(points[points.length - 1].score + trend.slope * monthsLeft) : null;
    return { year, points, slope: r2(trend.slope), projected: projected === null ? null : r2(projected), monthsLeft };
  }
}

const clampScore = (v: number) => Math.max(0, Math.min(100, v));

/** ميل خط الاتجاه بطريقة المربعات الصغرى (نقاط لكل شهر) */
export function linearTrend(values: number[]) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const xs = values.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (values[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}

export const PERFORMANCE_CODES = FINANCIAL_PERFORMANCE.flatMap((m) => m.subs.map((s) => s.code));
