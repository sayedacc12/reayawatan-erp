import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { OrgUser } from '../../../core/auth/decorators';
import { findSheet, isYes, loadXlsx, parseNum, readSheet, SheetCol, writeHelp, writeSheet } from '../../../core/files/xlsx-sheets';
import { Section } from './budget-defaults';
import { BudgetsService, ExcelLine } from './budgets.service';

const SHEET = 'البنود';
const MAX_LINES = 400;
/** حد المبلغ في الصف حتى لا يتجاوز سعة العمود numeric(16,2) */
const MAX_AMOUNT = 1_000_000_000_000;
const COLS: SheetCol[] = [
  { key: 'section', label: 'القسم', required: true, width: 20, list: ['الموارد البشرية', 'المصروفات التشغيلية', 'الأنشطة', 'الإيرادات'] },
  { key: 'kind', label: 'نوع البند', required: true, width: 12, list: ['مبلغ', 'وظيفة'], note: '«وظيفة» للموارد البشرية فقط: يُحتسب راتبها وتأميناتها بمعادلات النظام. «مبلغ» قيمة سنوية تكتبها' },
  { key: 'name', label: 'اسم البند', required: true, width: 40 },
  { key: 'amount', label: 'المبلغ السنوي', width: 14, note: 'لبنود «مبلغ»: القيمة السنوية بالريال دون ضريبة القيمة المضافة' },
  { key: 'distribution', label: 'التوزيع على الأشهر', width: 14, list: ['متساوٍ', 'موسمي'], note: 'الافتراضي متساوٍ' },
  { key: 'job', label: 'المسمى الوظيفي', width: 20 },
  { key: 'saudi', label: 'سعودي', width: 8, list: ['نعم', 'لا'] },
  { key: 'basic', label: 'الراتب الأساسي', width: 12 },
  { key: 'housing', label: 'بدل السكن', width: 10 },
  { key: 'transport', label: 'بدل النقل', width: 10 },
  { key: 'other', label: 'بدلات أخرى', width: 10 },
  { key: 'count', label: 'العدد', width: 7 },
  { key: 'from', label: 'من شهر', width: 8, note: '1 إلى 12' },
  { key: 'to', label: 'إلى شهر', width: 8 },
  { key: 'funding', label: 'نوع التمويل', width: 12, list: ['ذاتي', 'مقيد', 'مختلط'] },
  { key: 'note', label: 'ملاحظة', width: 50 },
];
const SECTION: Record<string, Section> = {
  'الموارد البشرية': 'hr', 'المصروفات التشغيلية': 'opex', المصروفات: 'opex', الأنشطة: 'activity', 'الأنشطة والمشاريع': 'activity', الإيرادات: 'revenue',
  hr: 'hr', opex: 'opex', activity: 'activity', revenue: 'revenue',
};
const FUNDING: Record<string, string> = { ذاتي: 'unrestricted', 'غير مقيد': 'unrestricted', مقيد: 'restricted', مختلط: 'mixed' };

export interface BudgetIssue { row: number | null; label: string | null; messages: string[] }
export interface BudgetImportResult {
  mode: 'check' | 'apply';
  ok: boolean;
  budget: { id: string; code: string; title: string; fiscalYear: number } | null;
  lines: { row: number; name: string; section: Section; amount: number; status: 'new' | 'exists' }[];
  totals: Record<Section, number>;
  errors: BudgetIssue[];
  warnings: BudgetIssue[];
}

/**
 * استيراد بنود موازنة قائمة من Excel: وظائف بمعادلات النظام، ومبالغ يدوية للموارد البشرية والمصروفات والأنشطة والإيرادات.
 * بنود الحسابات تُستورد من النظام المالي، وأنشطة الخطط التشغيلية المعتمدة من «استيراد الأنشطة»، فلا تُكتب هنا حتى لا تُحسب مرتين.
 */
@Injectable()
export class BudgetImportService {
  constructor(private readonly budgets: BudgetsService) {}

  async template() {
    const wb = new ExcelJS.Workbook();
    writeHelp(wb, [
      'استيراد بنود الموازنة التقديرية من Excel',
      '1. أنشئ الموازنة في النظام أولًا (السنة المالية والعنوان)، ثم افتح الموازنة واستورد هذا الملف منها.',
      '2. بند في كل صف. القسم: الموارد البشرية أو المصروفات التشغيلية أو الأنشطة أو الإيرادات.',
      '3. «مبلغ»: اكتب المبلغ السنوي. «وظيفة» (للموارد البشرية): اكتب الراتب والبدلات والعدد وأشهر السنة، ويحتسب النظام التأمينات والتكلفة.',
      '4. المبالغ دون ضريبة القيمة المضافة، لأن الضريبة تُحصَّل وتُورَّد ولا تُعد إيرادًا أو مصروفًا.',
      '5. أنشطة الخطط التشغيلية المعتمدة تُستورد من زر «استيراد الأنشطة» في الموازنة، وحسابات السنوات السابقة من «استيراد المصروفات والإيرادات». لا تكررها هنا.',
      '6. يُفحص الملف أولًا ويظهر لك تقرير بالأخطاء والمبالغ، ولا يُحفظ شيء حتى توافق. البند الموجود بالقسم والاسم نفسيهما لا يتكرر.',
    ]);
    writeSheet(wb, SHEET, COLS, [
      ['الإيرادات', 'مبلغ', 'مثال: إيرادات الخدمات الاستشارية', 100000, 'متساوٍ', '', '', '', '', '', '', '', '', '', '', ''],
      ['الموارد البشرية', 'وظيفة', 'مثال: مستشار', '', '', 'مستشار', 'نعم', 10000, 2500, 1000, 0, 1, 1, 12, 'ذاتي', ''],
    ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async import(actor: OrgUser, budgetId: string, file: Express.Multer.File | undefined, mode: string): Promise<BudgetImportResult> {
    if (mode !== 'check' && mode !== 'apply') throw new BadRequestException('وضع الاستيراد غير صحيح');
    const wb = await loadXlsx(file);
    const ws = findSheet(wb, SHEET);
    if (!ws) throw new BadRequestException(`الملف لا يحتوي ورقة «${SHEET}». نزّل النموذج من النظام`);
    const errors: BudgetIssue[] = [];
    const warnings: BudgetIssue[] = [];
    const lines: ExcelLine[] = [];
    const rowsOf: number[] = [];
    const seen = new Set<string>();
    for (const { row, v } of readSheet(ws, COLS, MAX_LINES, SHEET)) {
      const m: string[] = [];
      const section = SECTION[v.section];
      if (!section) m.push('القسم: الموارد البشرية أو المصروفات التشغيلية أو الأنشطة أو الإيرادات');
      const isJob = v.kind === 'وظيفة';
      if (!isJob && v.kind !== 'مبلغ') m.push('نوع البند: مبلغ أو وظيفة');
      if (isJob && section && section !== 'hr') m.push('«وظيفة» في قسم الموارد البشرية فقط');
      if (v.name.length < 2 || v.name.length > 300) m.push('اسم البند من 2 إلى 300 حرف');
      if (seen.has(`${section}|${v.name}`)) m.push('البند مكرر في الملف');
      seen.add(`${section}|${v.name}`);
      const num = (label: string, s: string, min = 0, max = MAX_AMOUNT) => {
        const n = parseNum(s);
        if (n !== null && (Number.isNaN(n) || n < min || n > max)) m.push(`«${label}» رقم من ${min} إلى ${max.toLocaleString('en-US')}`);
        return n === null || Number.isNaN(n) || n > max ? null : n;
      };
      let params: Record<string, unknown> = {};
      if (isJob) {
        const from = num('من شهر', v.from, 1, 12) ?? 1, to = num('إلى شهر', v.to, 1, 12) ?? 12;
        if (from > 12 || to > 12 || to < from) m.push('أشهر الوظيفة من 1 إلى 12، و«إلى شهر» لا يسبق «من شهر»');
        const basic = num('الراتب الأساسي', v.basic);
        if (!basic) m.push('اكتب الراتب الأساسي للوظيفة');
        params = {
          jobTitle: v.job || v.name, isSaudi: isYes(v.saudi), basic, housing: num('بدل السكن', v.housing) ?? 0, transport: num('بدل النقل', v.transport) ?? 0,
          other: num('بدلات أخرى', v.other) ?? 0, count: num('العدد', v.count, 1, 500) ?? 1, startMonth: from, endMonth: to,
        };
      } else {
        const amount = num('المبلغ السنوي', v.amount);
        if (amount === null) m.push('اكتب المبلغ السنوي');
        if (v.distribution && !['متساوٍ', 'متساو', 'موسمي'].includes(v.distribution)) m.push('التوزيع: متساوٍ أو موسمي');
        params = { manualAmount: amount, distribution: v.distribution === 'موسمي' ? 'seasonal' : 'even' };
      }
      if (v.funding && !FUNDING[v.funding]) m.push('نوع التمويل: ذاتي أو مقيد أو مختلط');
      if (m.length) { errors.push({ row, label: v.name || null, messages: m }); continue; }
      lines.push({
        section: section!, kind: isJob ? 'new_position' : section === 'hr' ? 'hr_other' : 'manual', name: v.name, params,
        fundingType: v.funding ? FUNDING[v.funding] : null, note: v.note ? v.note.slice(0, 1000) : null,
      });
      rowsOf.push(row);
    }
    const out: BudgetImportResult = { mode: mode as 'check' | 'apply', ok: false, budget: null, lines: [], totals: { hr: 0, opex: 0, activity: 0, revenue: 0 }, errors, warnings };
    if (!lines.length && !errors.length) throw new BadRequestException(`لا توجد بنود في ورقة «${SHEET}»`);
    if (errors.length) return out;
    try {
      const res = await this.budgets.importExcelLines(actor, budgetId, lines, mode === 'check');
      out.budget = res.budget;
      out.lines = res.lines.map((l, i) => ({ row: rowsOf[i], ...l }));
      for (const l of out.lines) {
        if (l.status === 'exists') warnings.push({ row: l.row, label: l.name, messages: ['يوجد بند بالقسم والاسم نفسيهما في الموازنة، فلن يُكرر'] });
        else out.totals[l.section] = Math.round((out.totals[l.section] + l.amount) * 100) / 100;
      }
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ConflictException || e instanceof ForbiddenException) {
        if (e instanceof ForbiddenException) throw e;
        errors.push({ row: null, label: null, messages: [String((e.getResponse() as { message?: string }).message ?? e.message)] });
        return out;
      }
      throw e;
    }
    out.ok = true;
    return out;
  }
}
