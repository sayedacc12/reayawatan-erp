import ExcelJS from 'exceljs';
import type { AttendanceConfig, MarkKind } from './entities/hr.entity';

/**
 * كشف الحضور الشهري (نموذج Excel يُنزَّل من المنصة ويُعبأ ثم يُرفع).
 * صف لكل موظف وعمود لكل يوم. الخانة الفارغة = حاضر، فلا يكتب المدخل إلا الاستثناءات:
 *   غ = غائب، إ = إجازة أو عذر (لا يُخصم)، رقم = دقائق التأخير، ح = حاضر (اختياري).
 */

export const SHEET_TITLE = 'كشف الحضور الشهري';
const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthName = (m: string) => `${AR_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const MAX_ROWS = 3000;
const MAX_LATE = 600;

const daysOf = (month: string) => {
  const out: string[] = [];
  for (let d = new Date(`${month}-01T00:00:00Z`); d.toISOString().slice(0, 7) === month; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

export interface SheetEmployee { employeeNo: number; fullName: string; unitName: string; from: string; to: string }

/** يبني ملف النموذج: الأيام غير المطلوبة (راحة، عطلة، خارج مدة الخدمة) مظللة رمادية */
export async function buildSheetTemplate(month: string, employees: SheetEmployee[], cfg: AttendanceConfig): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'سنابل';
  const ws = wb.addWorksheet('الحضور', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4, rightToLeft: true }] });
  const days = daysOf(month);
  const holidays = new Map(cfg.holidays.map((h) => [h.date, h.name]));
  const off = (d: string) => holidays.has(d) || cfg.weekend.includes(new Date(`${d}T00:00:00Z`).getUTCDay());
  const gray: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  const head: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
  const last = 3 + days.length;

  ws.mergeCells(1, 1, 1, last);
  ws.getCell(1, 1).value = `${SHEET_TITLE} · ${monthName(month)}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, last);
  ws.getCell(2, 1).value = 'اترك الخانة فارغة للحاضر. اكتب فقط: غ = غائب، إ = إجازة أو عذر، رقم = دقائق التأخير (مثل 30). الأيام الرمادية راحة أو عطلة ولا تُعبأ.';
  ws.getCell(2, 1).font = { color: { argb: 'FF6B7280' } };
  ws.getCell(3, 1).value = 'الشهر';
  ws.getCell(3, 2).value = month;
  ws.getCell(3, 2).font = { bold: true };

  const header = ws.getRow(4);
  header.values = ['رقم الموظف', 'الاسم', 'الإدارة', ...days.map((d) => `${Number(d.slice(8))}\n${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]}`)];
  header.height = 34;
  header.eachCell((c, col) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = col > 3 && off(days[col - 4]) ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9CA3AF' } } : head;
    if (col > 3 && holidays.has(days[col - 4])) c.note = holidays.get(days[col - 4])!;
  });
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 28;
  ws.getColumn(3).width = 20;
  for (let i = 0; i < days.length; i++) ws.getColumn(4 + i).width = 6.5;

  employees.forEach((e, idx) => {
    const r = ws.getRow(5 + idx);
    r.getCell(1).value = e.employeeNo;
    r.getCell(2).value = e.fullName;
    r.getCell(3).value = e.unitName;
    days.forEach((d, i) => {
      const c = r.getCell(4 + i);
      c.alignment = { horizontal: 'center' };
      if (off(d) || d < e.from || d > e.to) c.fill = gray;
    });
  });

  const help = wb.addWorksheet('التعليمات', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 16;
  help.getColumn(2).width = 70;
  [
    ['ماذا أكتب؟', 'المعنى'],
    ['(فارغ)', 'حاضر. هذا هو الأصل، فلا تكتب شيئًا للحاضرين'],
    ['غ', 'غائب، ويُخصم حسب اللائحة'],
    ['إ', 'إجازة أو غياب بعذر مقبول، ولا يُخصم'],
    ['رقم مثل 30', 'حاضر متأخرًا بعدد الدقائق، ويُخصم التأخير كاملًا إذا تجاوز فترة السماح في اللائحة'],
    ['ح', 'حاضر (اختياري، مثل الفارغ)'],
    ['', ''],
    ['ملاحظات', 'لا تغير رقم الموظف ولا خانة الشهر. يمكن حذف صفوف الموظفين غير المطلوبين. رفع الكشف مرة أخرى يستبدل بيانات الموظفين الذين فيه لهذا الشهر.'],
  ].forEach((row, i) => {
    help.getRow(i + 1).values = row;
    if (i === 0) help.getRow(1).font = { bold: true };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if (o.result !== undefined) return cellText(o.result as ExcelJS.CellValue);
    if (o.text !== undefined) return String(o.text).trim();
  }
  return String(v).trim();
}

const digits = (s: string) => s.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));

/** يفسر قيمة خانة يوم: null = حاضر بلا علامة */
export function parseMark(raw: string): { kind: MarkKind; minutes: number } | null | 'invalid' {
  const v = digits(raw).trim().replace(/[.\s]/g, '').toLowerCase();
  if (!v) return null;
  if (['غ', 'غائب', 'غياب', 'a'].includes(v)) return { kind: 'absent', minutes: 0 };
  if (['إ', 'ا', 'أ', 'ٳ', 'اجازة', 'إجازة', 'أجازة', 'عذر', 'l', 'e'].includes(v)) return { kind: 'leave', minutes: 0 };
  if (['ح', 'حاضر', 'p', '0'].includes(v)) return { kind: 'present', minutes: 0 };
  if (/^\d{1,3}$/.test(v)) {
    const n = Number(v);
    return n > 0 && n <= MAX_LATE ? { kind: 'late', minutes: n } : 'invalid';
  }
  return 'invalid';
}

export interface ParsedSheet {
  month: string | null;
  rows: { row: number; employeeNo: string; name: string; marks: { date: string; kind: MarkKind; minutes: number }[] }[];
  errors: { row: number | null; message: string }[];
}

const MAX_UNZIPPED = 30 * 1024 * 1024;
const MAX_ENTRIES = 200;

/** فحص الملف المضغوط قبل فكه: عدد الملفات وحجمها بعد الفك (يمنع الملفات المفخخة التي تتضخم عند الفك) */
export function assertSafeZip(buf: Buffer) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('الملف ليس ملف Excel صالحًا (xlsx). استخدم النموذج الذي نزّلته من المنصة');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error('الملف غير مقبول: يحوي عددًا كبيرًا من الأجزاء');
  let p = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('الملف ليس ملف Excel صالحًا (xlsx)');
    total += buf.readUInt32LE(p + 24);
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  if (total > MAX_UNZIPPED) throw new Error('الملف كبير جدًا بعد فك الضغط. قسّم الكشف على أكثر من ملف');
}

/** يقرأ الكشف المرفوع: يبحث عن خانة الشهر وصف العناوين (رقم الموظف + أعمدة الأيام) */
export async function readSheet(buf: Buffer): Promise<ParsedSheet> {
  assertSafeZip(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Error('الملف ليس ملف Excel صالحًا (xlsx). استخدم النموذج الذي نزّلته من المنصة');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('لم نجد ورقة بيانات في الملف');
  const out: ParsedSheet = { month: null, rows: [], errors: [] };
  let headerRow = 0;
  const dayCols = new Map<number, number>();
  for (let r = 1; r <= Math.min(ws.rowCount, 12) && !headerRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.min(row.cellCount, 6); c++) {
      const t = digits(cellText(row.getCell(c).value));
      if (!out.month && /^\d{4}-\d{2}$/.test(t)) out.month = t;
      if (/رقم الموظف/.test(t)) headerRow = r;
    }
  }
  if (!headerRow) throw new Error('لم نجد صف العناوين «رقم الموظف». استخدم النموذج الذي نزّلته من المنصة دون تغيير العناوين');
  const header = ws.getRow(headerRow);
  for (let c = 2; c <= header.cellCount; c++) {
    const m = /^(\d{1,2})(\D|$)/.exec(digits(cellText(header.getCell(c).value)));
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) dayCols.set(c, Number(m[1]));
  }
  if (!dayCols.size) throw new Error('لم نجد أعمدة أيام الشهر في صف العناوين');
  if (!out.month) return out;
  const monthDays = new Set(daysOf(out.month));
  const last = Math.min(ws.rowCount, headerRow + MAX_ROWS);
  if (ws.rowCount > headerRow + MAX_ROWS) out.errors.push({ row: null, message: `الكشف أكبر من ${MAX_ROWS} موظف. قسّمه على أكثر من ملف` });
  for (let r = headerRow + 1; r <= last; r++) {
    const row = ws.getRow(r);
    const no = digits(cellText(row.getCell(1).value)).replace(/\.0+$/, '');
    const name = cellText(row.getCell(2).value);
    const marks: ParsedSheet['rows'][number]['marks'] = [];
    let any = !!no;
    for (const [c, day] of dayCols) {
      const raw = cellText(row.getCell(c).value);
      if (!raw) continue;
      any = true;
      const date = `${out.month}-${String(day).padStart(2, '0')}`;
      if (!monthDays.has(date)) continue;
      const m = parseMark(raw);
      if (m === 'invalid') out.errors.push({ row: r, message: `اليوم ${day}: القيمة «${raw.slice(0, 20)}» غير مفهومة. اكتب غ أو إ أو عدد دقائق التأخير، أو اتركها فارغة` });
      else if (m) marks.push({ date, ...m });
    }
    if (!any) continue;
    if (!/^\d{1,9}$/.test(no)) {
      out.errors.push({ row: r, message: 'رقم الموظف فارغ أو غير صحيح' });
      continue;
    }
    out.rows.push({ row: r, employeeNo: no, name, marks });
  }
  return out;
}
