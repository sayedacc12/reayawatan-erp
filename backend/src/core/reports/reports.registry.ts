import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/decorators';
import { todayRiyadh } from '../organizations/org-access';
import { formatDateText, isNumeric, nowText } from './report-format';
import { ReportDefinition, ReportFilter, ReportFilters, ReportOption, ReportOutput, ReportResult, ReportRow } from './report.types';

export const MAX_ROWS = 20_000;
/** حد للاستعلام: سطر زائد واحد يكفي لمعرفة أن التقرير تجاوز الحد دون جلب كل الأسطر */
export const REPORT_QUERY_LIMIT = MAX_ROWS + 1;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * سجل التقارير المركزي: كل نظام يسجل تعريفات تقاريره هنا عند التشغيل
 * (عادة من خدمة <module>-reports.ts في onModuleInit)، والسجل يتولى الصلاحيات
 * والفلاتر والتشغيل الموحد.
 */
@Injectable()
export class ReportsRegistry {
  private readonly log = new Logger('Reports');
  private readonly defs = new Map<string, ReportDefinition>();

  register(defs: ReportDefinition[]) {
    for (const d of defs) {
      if (this.defs.has(d.code)) throw new Error(`Duplicate report code: ${d.code}`);
      if (!d.code.startsWith(`${d.module}.`)) throw new Error(`Report code must start with its module: ${d.code}`);
      this.defs.set(d.code, d);
    }
    this.log.log(`Registered ${defs.length} reports for ${[...new Set(defs.map((d) => d.module))].join(', ')}`);
  }

  all() {
    return [...this.defs.values()];
  }

  /** هل يستطيع المستخدم فتح التقرير؟ */
  canRun(user: AuthUser, d: ReportDefinition) {
    const scope = d.scope ?? 'organization';
    if (scope === 'organization' && !user.organizationId) return false;
    if (scope === 'platform' && user.organizationId) return false;
    const perms = Array.isArray(d.permission) ? d.permission : [d.permission];
    return perms.some((p) => user.permissions.includes(p)) && (d.permissionsAll ?? []).every((p) => user.permissions.includes(p));
  }

  get(user: AuthUser, code: string) {
    const d = this.defs.get(code);
    if (!d) throw new NotFoundException('التقرير غير موجود');
    if (!this.canRun(user, d)) throw new ForbiddenException('ليس لديك صلاحية لهذا التقرير');
    return d;
  }

  /** قائمة تقارير نظام معيّن المتاحة للمستخدم */
  catalog(user: AuthUser, module: string) {
    return this.all()
      .filter((d) => d.module === module && this.canRun(user, d))
      .map((d) => ({ code: d.code, title: d.title, description: d.description, category: d.category ?? null }));
  }

  /** تعريف التقرير كاملًا مع خيارات الفلاتر والقيم الافتراضية */
  async describe(user: AuthUser, code: string) {
    const d = this.get(user, code);
    const filters = await Promise.all((d.filters ?? []).map(async (f) => ({
      key: f.key, label: f.label, type: f.type, required: !!f.required, placeholder: f.placeholder ?? null,
      default: this.defaultValue(f),
      options: await this.options(user, f),
    })));
    return {
      code: d.code, module: d.module, title: d.title, description: d.description, category: d.category ?? null,
      columns: d.columns, filters, link: d.link ?? null, drill: d.drill ?? null,
    };
  }

  private async options(user: AuthUser, f: ReportFilter): Promise<ReportOption[] | null> {
    if (f.options) return f.options;
    if (f.loadOptions) return f.loadOptions(user);
    if (f.type === 'year') {
      const y = Number(todayRiyadh().slice(0, 4));
      return Array.from({ length: 6 }, (_, i) => String(y + 1 - i)).map((v) => ({ value: v, label: v }));
    }
    return null;
  }

  private defaultValue(f: ReportFilter): string | null {
    const t = todayRiyadh();
    switch (f.default) {
      case undefined: return null;
      case 'today': return t;
      case 'yearStart': return `${t.slice(0, 4)}-01-01`;
      case 'monthStart': return `${t.slice(0, 7)}-01`;
      case 'currentMonth': return t.slice(0, 7);
      case 'currentYear': return t.slice(0, 4);
      default: return f.default;
    }
  }

  /** تنظيف الفلاتر الواردة من الرابط والتحقق منها، وتعبئة القيم الافتراضية */
  private async resolveFilters(user: AuthUser, d: ReportDefinition, raw: Record<string, unknown>) {
    const values: ReportFilters = {};
    const applied: { label: string; value: string }[] = [];
    for (const f of d.filters ?? []) {
      const given = raw[f.key];
      let v = typeof given === 'string' && given.trim() !== '' ? given.trim() : undefined;
      if (v === undefined && given === undefined) v = this.defaultValue(f) ?? undefined;
      if (v === undefined) {
        if (f.required) throw new BadRequestException(`اختر ${f.label}`);
        continue;
      }
      let shown = v;
      if (f.type === 'date') {
        if (!DATE.test(v)) throw new BadRequestException(`${f.label}: تاريخ غير صحيح`);
        shown = formatDateText(v);
      } else if (f.type === 'month') {
        if (!MONTH.test(v)) throw new BadRequestException(`${f.label}: الشهر غير صحيح`);
      } else if (f.type === 'year') {
        if (!YEAR.test(v)) throw new BadRequestException(`${f.label}: السنة غير صحيحة`);
      } else if (f.type === 'select') {
        const opts = await this.options(user, f);
        const opt = opts?.find((o) => o.value === v);
        if (!opt) throw new BadRequestException(`${f.label}: اختيار غير صحيح`);
        shown = opt.label;
      } else if (f.type === 'text') {
        v = v.slice(0, 200);
        shown = v;
      }
      values[f.key] = v;
      applied.push({ label: f.label, value: shown });
    }
    if (values.from && values.to && values.from > values.to) throw new BadRequestException('بداية الفترة يجب أن تكون قبل نهايتها');
    // الفترة تظهر في سطر واحد
    const from = applied.findIndex((a) => a.label === d.filters?.find((f) => f.key === 'from')?.label);
    const to = applied.findIndex((a) => a.label === d.filters?.find((f) => f.key === 'to')?.label);
    if (from >= 0 && to >= 0) {
      applied.splice(from, 1, { label: 'الفترة', value: `من ${applied[from].value} إلى ${applied[to].value}` });
      applied.splice(to, 1);
    }
    return { values, applied };
  }

  async run(user: AuthUser, code: string, raw: Record<string, unknown>): Promise<ReportOutput> {
    const d = this.get(user, code);
    const { values, applied } = await this.resolveFilters(user, d, raw);
    const res = await d.run(user, values);
    const out: ReportResult = Array.isArray(res) ? { rows: res } : res;
    if (out.rows.length > MAX_ROWS) {
      throw new BadRequestException(`التقرير أكبر من ${MAX_ROWS.toLocaleString('ar-SA')} سطر، ضيّق الفترة أو الفلاتر`);
    }
    const columns = out.columns ?? d.columns;
    let totals: Record<string, number> | null = out.totals ?? null;
    if (!totals && columns.some((c) => c.total)) {
      totals = {};
      const counted = out.rows.filter((r: ReportRow) => !r._skipTotal);
      for (const c of columns.filter((x) => x.total && isNumeric(x.type))) {
        totals[c.key] = r2(counted.reduce((s, r) => s + (Number(r[c.key]) || 0), 0));
      }
    }
    return {
      code: d.code, title: d.title, description: d.description, subtitle: out.subtitle ?? null,
      organizationName: user.organizationName ?? (d.scope === 'platform' ? 'إدارة المنصة' : null),
      generatedAt: nowText(), generatedBy: user.fullName,
      appliedFilters: applied, columns, rows: out.rows, totals, summary: out.summary ?? [], notes: out.notes ?? [],
      orientation: d.orientation ?? (columns.length > 7 ? 'landscape' : 'portrait'),
      indentColumn: d.indentColumn ?? null,
    };
  }
}
