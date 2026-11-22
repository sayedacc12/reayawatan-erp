import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { assertSafeXlsx } from './xlsx-guard';

/**
 * أدوات مشتركة لنماذج الاستيراد من Excel: فتح الملف بعد فحصه، وقراءة ورقة بأعمدة معروفة بأسمائها
 * (لا بترتيبها)، وقراءة ورقة «حقل | قيمة»، وكتابة نموذج بأعمدة وتعليمات.
 */

export const IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if (o.result !== undefined) return cellText(o.result as ExcelJS.CellValue);
    if (o.text !== undefined) return String(o.text).trim();
    return '';
  }
  // الأرقام العربية الهندية تُحوَّل إلى إنجليزية
  return String(v).trim().replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
}

export async function loadXlsx(file: Express.Multer.File | undefined): Promise<ExcelJS.Workbook> {
  if (!file?.buffer?.length) throw new BadRequestException('اختر ملف Excel');
  if (!/\.xlsx$/i.test(file.originalname ?? '')) throw new BadRequestException('الملف يجب أن يكون Excel بصيغة xlsx (استخدم النموذج المنزَّل من النظام)');
  if (file.buffer.length > IMPORT_FILE_BYTES) throw new BadRequestException('حجم الملف أكبر من المسموح (2 ميجابايت)');
  assertSafeXlsx(file.buffer);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('تعذرت قراءة الملف. تأكد أنه ملف Excel سليم');
  }
  return wb;
}

/** حد أعمدة الورقة: النماذج كلها أقل من 40 عمودًا */
const MAX_COLS = 80;

export interface SheetCol { key: string; label: string; width?: number; required?: boolean; note?: string; list?: string[] }
export interface SheetRow { row: number; v: Record<string, string>; extra: Record<string, string> }

/**
 * صفوف ورقة بأعمدة معروفة. الأعمدة الإلزامية يجب أن توجد عناوينها في السطر الأول.
 * الأعمدة غير المعروفة تُعاد في extra بعنوانها (مثل «مستهدف 2027»)، والصفوف الفارغة تُتجاهل.
 */
export function readSheet(ws: ExcelJS.Worksheet, cols: SheetCol[], maxRows: number, sheetName: string): SheetRow[] {
  if (ws.actualColumnCount > MAX_COLS || ws.getRow(1).cellCount > MAX_COLS) throw new BadRequestException(`ورقة «${sheetName}» فيها أعمدة أكثر من ${MAX_COLS}. نزّل النموذج من النظام واستخدم عناوينه`);
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map(cellText);
  const at = new Map<string, number>();
  header.forEach((h, i) => { if (h) at.set(h.replace(/\s*\*\s*$/, ''), i); });
  const missing = cols.filter((c) => c.required && !at.has(c.label)).map((c) => c.label);
  if (missing.length) throw new BadRequestException(`ورقة «${sheetName}» ينقصها العمود «${missing.slice(0, 3).join('»، «')}». نزّل النموذج من النظام واستخدم عناوينه`);
  const known = new Set(cols.map((c) => c.label));
  const out: SheetRow[] = [];
  // eachRow يمر على الصفوف الموجودة فعلًا فقط، فلا يُنشئ صفوفًا فارغة لملف فيه خلية بعيدة في آخر الورقة
  let seen = 0;
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (r < 2) return;
    if (++seen > maxRows * 4) throw new BadRequestException(`ورقة «${sheetName}» تتجاوز ${maxRows} صف`);
    if (row.cellCount > MAX_COLS) throw new BadRequestException(`ورقة «${sheetName}» فيها أعمدة أكثر من ${MAX_COLS}`);
    const vals = (row.values as ExcelJS.CellValue[]).map(cellText);
    if (!vals.some((x) => x)) return;
    if (out.length >= maxRows) throw new BadRequestException(`ورقة «${sheetName}» تتجاوز ${maxRows} صف`);
    const v: Record<string, string> = {};
    for (const c of cols) v[c.key] = at.has(c.label) ? vals[at.get(c.label)!] ?? '' : '';
    const extra: Record<string, string> = {};
    for (const [label, i] of at) if (!known.has(label)) extra[label] = vals[i] ?? '';
    out.push({ row: r, v, extra });
  });
  return out;
}

/** ورقة «الحقل | القيمة»: يُعاد كل حقل باسمه دون النجمة */
export function readKeyValues(ws: ExcelJS.Worksheet): Map<string, string> {
  const out = new Map<string, string>();
  for (let r = 1; r <= Math.min(ws.rowCount, 100); r++) {
    const k = cellText(ws.getCell(r, 1).value).replace(/\s*\*\s*$/, '');
    if (k && r > 1) out.set(k, cellText(ws.getCell(r, 2).value));
  }
  return out;
}

export function findSheet(wb: ExcelJS.Workbook, name: string) {
  return wb.worksheets.find((w) => w.name.trim() === name) ?? null;
}

const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0F766E' } };

/** ورقة نموذج بأعمدة وأمثلة وقوائم اختيار */
export function writeSheet(wb: ExcelJS.Workbook, name: string, cols: SheetCol[], rows: (string | number | null)[][], listRows = 300) {
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.required ? `${c.label} *` : c.label, key: c.key, width: c.width ?? 18 }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = HEAD_FILL;
  head.alignment = { vertical: 'middle', wrapText: true };
  cols.forEach((c, i) => { if (c.note) ws.getCell(1, i + 1).note = c.note; });
  rows.forEach((r) => { const row = ws.addRow(r); row.alignment = { vertical: 'top', wrapText: true }; });
  cols.forEach((c, i) => {
    if (!c.list?.length) return;
    for (let r = 2; r <= Math.max(listRows, rows.length + 1); r++) {
      ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: !c.required, formulae: [`"${c.list.join(',')}"`] };
    }
  });
  return ws;
}

export function writeKeyValues(wb: ExcelJS.Workbook, name: string, rows: [string, string | number | null, string?][]) {
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true }] });
  ws.columns = [{ header: 'الحقل', width: 28 }, { header: 'القيمة', width: 80 }, { header: 'ملاحظة', width: 50 }];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = HEAD_FILL;
  rows.forEach((r) => { const row = ws.addRow([r[0], r[1] ?? '', r[2] ?? '']); row.alignment = { vertical: 'top', wrapText: true }; });
  return ws;
}

export function writeHelp(wb: ExcelJS.Workbook, lines: string[]) {
  const help = wb.addWorksheet('التعليمات', { views: [{ rightToLeft: true }] });
  help.columns = [{ width: 120 }];
  lines.forEach((t, i) => { const row = help.addRow([t]); row.alignment = { wrapText: true }; if (i === 0) row.font = { bold: true, size: 13 }; });
  return help;
}

// ---------------------------------------------------------------- تحويل القيم

export const isYes = (s: string) => ['نعم', 'yes', 'y', '1', 'true', 'صح', '✓'].includes(s.trim().toLowerCase());

/** تاريخ بصيغة 2027-01-31 أو 31/01/2027، أو null إن كان فارغًا، أو undefined إن كان غير صحيح */
export function parseDate(s: string): string | null | undefined {
  const t = s.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) [y, mo, d] = [Number(m[3]), Number(m[2]), Number(m[1])];
  else return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

/** رقم من نص (يقبل الفواصل وعلامة %)، أو null إن كان فارغًا، أو NaN إن كان غير صحيح */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/[,،٬\s]/g, '').replace(/%$/, '');
  if (!t) return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** قائمة من سطور (أو من فاصلة منقوطة) */
export const lines = (s: string) => s.split(/\r?\n|؛|;/).map((x) => x.trim()).filter(Boolean);
