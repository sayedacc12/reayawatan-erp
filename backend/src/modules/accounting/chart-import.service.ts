import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { assertSafeXlsx } from '../../core/files/xlsx-guard';
import { lockChart, MAX_LEVELS } from './accounts.service';
import { Account, AccountKind, AccountNature } from './entities/accounting.entity';

/** أعمدة نموذج استيراد الدليل بالترتيب */
const COLS = [
  { key: 'code', label: 'رقم الحساب *', width: 16, note: 'أرقام أو حروف إنجليزية بلا مسافات، ولا يتكرر' },
  { key: 'name', label: 'اسم الحساب *', width: 40 },
  { key: 'parent', label: 'رقم الحساب الأب', width: 18, note: 'فارغ للحساب الجذري فقط. الأب من الملف نفسه أو من الدليل الحالي' },
  { key: 'kind', label: 'النوع *', width: 12, note: 'جذري أو رئيسي أو فرعي (التسجيل على الفرعي فقط)' },
  { key: 'nature', label: 'الطبيعة', width: 16, note: 'أصول، خصوم، حقوق ملكية، إيرادات، مصروفات. فارغة = طبيعة الحساب الأب' },
  { key: 'analytic', label: 'يتطلب مركز تكلفة (نعم/لا)', width: 16, note: 'للحسابات الفرعية فقط' },
  { key: 'description', label: 'الوصف', width: 30 },
  { key: 'active', label: 'نشط (نعم/لا)', width: 12, note: 'فارغ = نشط' },
] as const;
type ColKey = (typeof COLS)[number]['key'];
const SHEET = 'الحسابات';
const MAX_ROWS = 5000;
const YES = ['نعم', 'yes', 'y', '1', 'true', 'صح', '✓'];
const NO = ['لا', 'no', 'n', '0', 'false'];
const CODE_RE = /^[0-9A-Za-z.-]{1,30}$/;

const KIND_BY_LABEL: Record<string, AccountKind> = { جذري: 'root', رئيسي: 'main', فرعي: 'sub', root: 'root', main: 'main', sub: 'sub' };
const NATURE_BY_LABEL: Record<string, AccountNature> = {
  أصول: 'assets', الأصول: 'assets', خصوم: 'liabilities', الخصوم: 'liabilities', التزامات: 'liabilities', الالتزامات: 'liabilities',
  'حقوق ملكية': 'net_assets', 'حقوق الملكية': 'net_assets', 'صافي أصول': 'net_assets', 'صافي الأصول': 'net_assets',
  إيرادات: 'revenue', الإيرادات: 'revenue', مصروفات: 'expenses', المصروفات: 'expenses',
  assets: 'assets', liabilities: 'liabilities', equity: 'net_assets', net_assets: 'net_assets', revenue: 'revenue', expenses: 'expenses',
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if (o.result !== undefined) return cellText(o.result as ExcelJS.CellValue);
    if (o.text !== undefined) return String(o.text).trim();
  }
  // الأرقام العربية الهندية تُحوَّل إلى إنجليزية
  return String(v).trim().replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
}

export interface ImportRowResult { row: number; code: string; name: string; reasons: string[] }
export interface ChartImportResult {
  mode: 'check' | 'apply';
  total: number;
  accepted: { row: number; code: string; name: string; kind: AccountKind; nature: AccountNature; parentCode: string | null; level: number }[];
  skipped: ImportRowResult[];
  created: number;
}

interface Node { id?: string; code: string; kind: AccountKind; nature: AccountNature; level: number; fromFile: boolean }

/**
 * استيراد الدليل المحاسبي من Excel. كل حساب يُفحص وحده: يُدرج الحساب المطابق للمواصفات، ويُستبعد غير المطابق مع سببه،
 * ويُستبعد كذلك كل حساب أبوه مستبعد. وضع «check» يفحص الملف ويعرض التقرير دون حفظ شيء؛ و«apply» يحفظ المقبول فقط
 * في معاملة واحدة ويعيد التقرير نفسه. لا يعدّل أي حساب موجود في الدليل.
 */
@Injectable()
export class ChartImportService {
  private readonly logger = new Logger('ChartImport');

  constructor(private readonly db: DataSource) {}

  /** نموذج فارغ بالأعمدة والتعليمات وقوائم الاختيار، مع أمثلة توضح البناء */
  async template() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = COLS.map((c) => ({ header: c.label, key: c.key, width: c.width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    COLS.forEach((c, i) => { if ('note' in c && c.note) ws.getCell(1, i + 1).note = c.note; });
    const examples = [
      ['1', 'الأصول', '', 'جذري', 'أصول', '', '', ''],
      ['11', 'الأصول المتداولة', '1', 'رئيسي', '', '', '', ''],
      ['1101', 'النقدية في البنوك', '11', 'فرعي', '', 'لا', '', ''],
      ['4', 'المصروفات', '', 'جذري', 'مصروفات', '', '', ''],
      ['41', 'المصاريف العمومية والإدارية', '4', 'رئيسي', '', '', '', ''],
      ['4101', 'الرواتب والأجور', '41', 'فرعي', '', 'نعم', '', ''],
    ];
    examples.forEach((r) => ws.addRow(r));
    for (let r = 2; r <= MAX_ROWS + 1; r++) {
      ws.getCell(r, 4).dataValidation = { type: 'list', allowBlank: false, formulae: ['"جذري,رئيسي,فرعي"'] };
      ws.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, formulae: ['"أصول,خصوم,حقوق ملكية,إيرادات,مصروفات"'] };
      ws.getCell(r, 6).dataValidation = { type: 'list', allowBlank: true, formulae: ['"نعم,لا"'] };
      ws.getCell(r, 8).dataValidation = { type: 'list', allowBlank: true, formulae: ['"نعم,لا"'] };
    }
    const help = wb.addWorksheet('التعليمات', { views: [{ rightToLeft: true }] });
    help.columns = [{ width: 110 }];
    [
      'طريقة الاستيراد',
      '1. اكتب الحسابات في ورقة «الحسابات» ابتداءً من السطر الثاني، واحذف الأمثلة أو عدّلها.',
      '2. الحساب الجذري بلا أب. الرئيسي والفرعي لهما أب من الملف نفسه أو من الدليل الحالي في النظام.',
      '3. التسجيل في القيود على الحسابات الفرعية فقط، وكل الحسابات الفرعية في مستوى واحد، ولا يُفتح حساب تحت حساب فرعي.',
      `4. الدليل حتى ${MAX_LEVELS} مستويات. الطبيعة الفارغة تأخذ طبيعة الحساب الأب.`,
      '5. ارفع الملف من شاشة الدليل المحاسبي: يُفحص أولًا ويظهر لك تقرير بالحسابات المقبولة والمستبعدة وسبب كل استبعاد، ولا يُحفظ شيء حتى توافق.',
      '6. عند الموافقة تُضاف الحسابات المطابقة فقط، ويُستبعد غير المطابق وكل حساب تحته. الحسابات الموجودة في الدليل لا تتغير.',
    ].forEach((t, i) => { const row = help.addRow([t]); if (i === 0) row.font = { bold: true, size: 13 }; });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async import(actor: OrgUser, file: Express.Multer.File | undefined, mode: string): Promise<ChartImportResult> {
    if (mode !== 'check' && mode !== 'apply') throw new BadRequestException('وضع الاستيراد غير صحيح');
    if (!file?.buffer?.length) throw new BadRequestException('اختر ملف Excel');
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('الملف يجب أن يكون Excel بصيغة xlsx (استخدم النموذج المنزَّل من النظام)');
    assertSafeXlsx(file.buffer);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('تعذرت قراءة الملف. تأكد أنه ملف Excel سليم');
    }
    const ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
    if (!ws) throw new BadRequestException(`الملف لا يحتوي ورقة «${SHEET}»`);
    const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(cellText);
    const missing = COLS.filter((c, i) => header[i] !== c.label).map((c) => c.label);
    if (missing.length) {
      throw new BadRequestException(`الملف ليس نموذج استيراد الدليل: الأعمدة «${missing.slice(0, 3).join('»، «')}» غير موجودة في مكانها. نزّل النموذج من النظام واستخدمه`);
    }
    const rows: { row: number; v: Record<ColKey, string> }[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const vals = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1).map(cellText);
      if (!vals.some((x) => x)) continue;
      if (rows.length >= MAX_ROWS) throw new BadRequestException(`الملف يتجاوز ${MAX_ROWS} حساب`);
      rows.push({ row: r, v: Object.fromEntries(COLS.map((c, i) => [c.key, vals[i] ?? ''])) as Record<ColKey, string> });
    }
    if (!rows.length) throw new BadRequestException(`لا توجد حسابات في الملف. اكتبها ابتداءً من السطر الثاني في ورقة «${SHEET}»`);

    const org = actor.organizationId;
    if (mode === 'check') return this.evaluate(org, rows, mode, (await this.existing(org)));
    // الحفظ داخل معاملة واحدة مع قفل دليل الشركة، فيُعاد الفحص على الدليل كما هو لحظة الحفظ
    return this.db.transaction(async (em) => {
      await lockChart(em, org);
      const result = this.evaluate(org, rows, mode, await this.existing(org, em));
      const ids = new Map<string, string>((await em.query('SELECT id, code FROM acc_accounts WHERE organization_id = $1', [org]) as { id: string; code: string }[]).map((x) => [x.code, x.id]));
      const byRow = new Map(rows.map((r) => [r.row, r.v]));
      // الآباء قبل الأبناء
      for (const a of [...result.accepted].sort((x, y) => x.level - y.level)) {
        const v = byRow.get(a.row)!;
        const saved = await em.getRepository(Account).save(em.create(Account, {
          organizationId: org, code: a.code, name: a.name, kind: a.kind, nature: a.nature, level: a.level,
          parentId: a.parentCode ? ids.get(a.parentCode)! : null,
          requiresAnalytic: a.kind === 'sub' && YES.includes(v.analytic.toLowerCase()),
          description: v.description || null, isActive: !NO.includes(v.active.toLowerCase()),
        }));
        ids.set(saved.code, saved.id);
      }
      result.created = result.accepted.length;
      this.logger.log(`Chart import for org ${org} by ${actor.id}: ${result.created} added, ${result.skipped.length} skipped`);
      return result;
    }).catch((e) => {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('أُضيف حساب بالرقم نفسه أثناء الاستيراد. أعد رفع الملف');
      throw e;
    });
  }

  private async existing(org: string, em = this.db.manager): Promise<Map<string, Node>> {
    const rows: { id: string; code: string; kind: AccountKind; nature: AccountNature; level: number }[] = await em.query(
      'SELECT id, code, kind, nature, level FROM acc_accounts WHERE organization_id = $1', [org]);
    return new Map(rows.map((r) => [r.code, { ...r, fromFile: false }]));
  }

  /** فحص كل حساب على الدليل الحالي وما قُبل قبله من الملف */
  private evaluate(_org: string, rows: { row: number; v: Record<ColKey, string> }[], mode: 'check' | 'apply', chart: Map<string, Node>): ChartImportResult {
    const accepted: ChartImportResult['accepted'] = [];
    const skipped: ImportRowResult[] = [];
    const firstRow = new Map<string, number>();
    const skippedCodes = new Set<string>();
    const existingSubs = [...chart.values()].filter((n) => n.kind === 'sub').map((n) => n.level);
    // مستوى التسجيل: من الدليل الحالي، وإلا الأكثر تكرارًا بين الحسابات الفرعية في الملف بعد حساب مستوياتها
    let posting: number | null = existingSubs.length ? existingSubs[0] : null;

    // ترتيب الحسابات بحيث يأتي الأب قبل ابنه أيًا كان ترتيب الصفوف في الملف
    const pending = rows.map((r) => ({ ...r, code: r.v.code.trim(), parent: r.v.parent.trim() }));
    const fileCodes = new Map<string, number>();
    for (const r of pending) if (r.code && !fileCodes.has(r.code)) fileCodes.set(r.code, r.row);

    type Cand = (typeof pending)[number] & { reasons: string[]; kind?: AccountKind; nature?: AccountNature; level?: number };
    const cands: Cand[] = pending.map((r) => ({ ...r, reasons: [] }));
    // فحوص الصف وحده
    for (const c of cands) {
      const { v } = c;
      if (!c.code) c.reasons.push('رقم الحساب فارغ');
      else if (!CODE_RE.test(c.code)) c.reasons.push('رقم الحساب أرقام أو حروف إنجليزية فقط، بلا مسافات، حتى 30 خانة');
      else if (firstRow.has(c.code)) c.reasons.push(`رقم الحساب مكرر في الملف (الصف ${firstRow.get(c.code)})`);
      else if (chart.has(c.code)) c.reasons.push('رقم الحساب موجود في الدليل من قبل');
      if (c.code && !firstRow.has(c.code)) firstRow.set(c.code, c.row);
      if (v.name.length < 2) c.reasons.push('اسم الحساب فارغ أو أقصر من حرفين');
      else if (v.name.length > 250) c.reasons.push('اسم الحساب أطول من 250 حرفًا');
      if (v.description.length > 1000) c.reasons.push('الوصف أطول من 1000 حرف');
      c.kind = KIND_BY_LABEL[v.kind.toLowerCase()];
      if (!c.kind) c.reasons.push(v.kind ? `النوع «${v.kind}» غير صحيح: اكتب جذري أو رئيسي أو فرعي` : 'النوع فارغ: اكتب جذري أو رئيسي أو فرعي');
      if (v.nature) {
        c.nature = NATURE_BY_LABEL[v.nature.toLowerCase()];
        if (!c.nature) c.reasons.push(`الطبيعة «${v.nature}» غير صحيحة: اكتب أصول أو خصوم أو حقوق ملكية أو إيرادات أو مصروفات`);
      }
      if (c.kind === 'root' && c.parent) c.reasons.push('الحساب الجذري لا يكون له حساب أب');
      if (c.kind && c.kind !== 'root' && !c.parent) c.reasons.push('الحساب الرئيسي أو الفرعي يحتاج رقم الحساب الأب');
      if (c.kind === 'root' && !v.nature) c.reasons.push('الحساب الجذري يحتاج طبيعة (لا أب يأخذ منه طبيعته)');
      if (c.parent && c.parent === c.code) c.reasons.push('الحساب لا يكون أبًا لنفسه');
      if (v.analytic && !YES.includes(v.analytic.toLowerCase()) && !NO.includes(v.analytic.toLowerCase())) c.reasons.push('«يتطلب مركز تكلفة» نعم أو لا');
      if (v.active && !YES.includes(v.active.toLowerCase()) && !NO.includes(v.active.toLowerCase())) c.reasons.push('«نشط» نعم أو لا');
    }

    // حل الشجرة: كل دورة تقبل أو تستبعد ما عُرف أبوه
    const accept = (c: Cand, parent: Node | null) => {
      c.level = parent ? parent.level + 1 : 1;
      c.nature = c.nature ?? parent?.nature;
      if (parent && parent.kind === 'sub') c.reasons.push(`الحساب الأب ${parent.code} فرعي، ولا يُفتح حساب تحت حساب فرعي`);
      if (c.level > MAX_LEVELS) c.reasons.push(`الدليل حتى ${MAX_LEVELS} مستويات، وهذا الحساب في المستوى ${c.level}`);
      if (c.kind === 'main' && c.level === MAX_LEVELS) c.reasons.push(`المستوى ${MAX_LEVELS} هو الأخير، فلا يكون الحساب فيه إلا فرعيًا`);
    };
    const open = new Set(cands.filter((c) => !c.reasons.length));
    for (const c of cands) if (c.reasons.length) { skippedCodes.add(c.code); }
    const resolved: Cand[] = [];
    let progress = true;
    while (open.size && progress) {
      progress = false;
      for (const c of [...open]) {
        let parent: Node | null = null;
        if (c.kind !== 'root') {
          if (chart.has(c.parent)) parent = chart.get(c.parent)!;
          else if (skippedCodes.has(c.parent) && fileCodes.has(c.parent)) {
            c.reasons.push(`الحساب الأب ${c.parent} لم يُدرج (الصف ${fileCodes.get(c.parent)})`);
          } else if (!fileCodes.has(c.parent)) {
            c.reasons.push(`الحساب الأب ${c.parent} غير موجود في الملف ولا في الدليل`);
          } else continue; // الأب في الملف ولم يُحسم بعد
        }
        open.delete(c);
        progress = true;
        if (!c.reasons.length) accept(c, parent);
        if (c.reasons.length) { skippedCodes.add(c.code); continue; }
        chart.set(c.code, { code: c.code, kind: c.kind!, nature: c.nature!, level: c.level!, fromFile: true });
        resolved.push(c);
      }
    }
    // ما بقي معلقًا حلقة في الآباء (أ أبو ب وب أبو أ)
    for (const c of open) { c.reasons.push('حلقة في الحسابات الأب: الحساب يقع تحت نفسه'); skippedCodes.add(c.code); }

    // مستوى التسجيل للحسابات الفرعية الجديدة
    if (posting === null) {
      const freq = new Map<number, number>();
      for (const c of resolved) if (c.kind === 'sub') freq.set(c.level!, (freq.get(c.level!) ?? 0) + 1);
      posting = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
    }
    // استبعاد ما يخالف مستوى التسجيل، ثم كل ما تحته
    const bad = new Set<string>();
    for (const c of resolved) {
      if (posting !== null && c.kind === 'sub' && c.level !== posting) c.reasons.push(`كل الحسابات الفرعية في المستوى ${posting}، وهذا الحساب في المستوى ${c.level}`);
      if (posting !== null && c.kind !== 'sub' && c.level! >= posting) c.reasons.push(`الحسابات الفرعية في المستوى ${posting}، فالحساب ${c.kind === 'root' ? 'الجذري' : 'الرئيسي'} يجب أن يكون في مستوى أعلى منه`);
      if (!c.reasons.length && bad.has(c.parent)) c.reasons.push(`الحساب الأب ${c.parent} لم يُدرج (الصف ${fileCodes.get(c.parent)})`);
      if (c.reasons.length) bad.add(c.code);
    }
    for (const c of cands) {
      if (c.reasons.length) skipped.push({ row: c.row, code: c.code, name: c.v.name, reasons: c.reasons });
    }
    for (const c of resolved) {
      if (!c.reasons.length) accepted.push({ row: c.row, code: c.code, name: c.v.name, kind: c.kind!, nature: c.nature!, parentCode: c.kind === 'root' ? null : c.parent, level: c.level! });
    }
    skipped.sort((a, b) => a.row - b.row);
    accepted.sort((a, b) => a.row - b.row);
    return { mode, total: rows.length, accepted, skipped, created: 0 };
  }
}

