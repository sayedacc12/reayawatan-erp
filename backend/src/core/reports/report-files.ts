import ExcelJS from 'exceljs';
import { isEmpty, isNumeric, plainValue, toDate } from './report-format';
import { ReportColumn, ReportOutput } from './report.types';

/** ملف CSV بترميز UTF-8 مع BOM حتى يفتحه Excel بالعربي مباشرة */
export function renderCsv(r: ReportOutput): Buffer {
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [r.columns.map((c) => q(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => q(plainValue(row[c.key], c.type))).join(','));
  if (r.totals && r.rows.length) {
    lines.push(r.columns.map((c, i) => (r.totals![c.key] !== undefined ? String(r.totals![c.key]) : i === 0 ? 'الإجمالي' : '')).join(','));
  }
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

const NUM_FMT: Partial<Record<NonNullable<ReportColumn['type']>, string>> = {
  money: '#,##0.00;[Red]-#,##0.00', number: '#,##0.##', percent: '0.##"%"', date: 'yyyy/mm/dd', datetime: 'yyyy/mm/dd hh:mm',
};

function excelValue(v: unknown, c: ReportColumn): ExcelJS.CellValue {
  if (isEmpty(v)) return null;
  if (isNumeric(c.type)) return Number.isFinite(Number(v)) ? Number(v) : String(v);
  if (c.type === 'date' || c.type === 'datetime') {
    const d = toDate(v);
    if (!d) return String(v);
    // Excel لا يعرف المناطق الزمنية: نكتب الوقت كما يظهر في الرياض
    return c.type === 'datetime' ? new Date(d.getTime() + 3 * 3600_000) : d;
  }
  if (c.type === 'bool') return v === true || v === 'true' ? 'نعم' : 'لا';
  return String(v);
}

/** ملف Excel حقيقي: ورقة من اليمين لليسار، أرقام قابلة للجمع، رأس ثابت وفلترة تلقائية */
export async function renderXlsx(r: ReportOutput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sanabel ERP';
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 0 }],
    pageSetup: { paperSize: 9, orientation: r.orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const n = Math.max(r.columns.length, 1);
  const font = { name: 'Arial' };
  const band = (text: string, size: number, bold: boolean, color = 'FF1B2733') => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, n);
    row.getCell(1).font = { ...font, size, bold, color: { argb: color } };
    row.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    return row;
  };
  if (r.organizationName) band(r.organizationName, 11, true, 'FF0F766E');
  band(r.title, 15, true).height = 22;
  band(r.description, 10, false, 'FF64748B');
  if (r.subtitle) band(r.subtitle, 11, true, 'FF0F766E');
  const meta = [...r.appliedFilters.map((f) => `${f.label}: ${f.value}`), `أُعد بواسطة: ${r.generatedBy}`, `تاريخ الإصدار: ${r.generatedAt}`];
  band(meta.join('   ·   '), 9, false, 'FF64748B');
  for (const s of r.summary) {
    const row = ws.addRow([s.label, s.value ?? '']);
    row.getCell(1).font = { ...font, color: { argb: 'FF64748B' } };
    row.getCell(2).font = { ...font, bold: true };
    if (s.type && NUM_FMT[s.type]) row.getCell(2).numFmt = NUM_FMT[s.type]!;
  }
  ws.addRow([]);

  const header = ws.addRow(r.columns.map((c) => c.label));
  header.height = 20;
  header.eachCell((cell) => {
    cell.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  const headerRow = header.number;
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: headerRow }];

  for (const row of r.rows) {
    const x = ws.addRow(r.columns.map((c) => excelValue(row[c.key], c)));
    const indentAt = Math.max(0, r.columns.findIndex((c) => c.key === (r.indentColumn ?? r.columns[0]?.key))) + 1;
    if (row._level && row._level > 1) x.getCell(indentAt).alignment = { indent: Math.min(row._level - 1, 10) };
    if (row._style === 'strong' || row._style === 'group') x.font = { ...font, bold: true };
    if (row._style === 'group') x.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF6E7' } }; });
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type && NUM_FMT[c.type]) col.numFmt = NUM_FMT[c.type]!;
    const longest = Math.max(c.label.length, ...r.rows.slice(0, 500).map((row) => String(row[c.key] ?? '').length));
    col.width = c.width ?? Math.min(Math.max(longest + 2, isNumeric(c.type) ? 14 : 10), 50);
  });
  if (r.rows.length) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + r.rows.length, column: n } };
  }
  if (r.totals && r.rows.length) {
    const t = ws.addRow(r.columns.map((c, i) => (r.totals![c.key] !== undefined ? r.totals![c.key] : i === 0 ? 'الإجمالي' : null)));
    t.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...font, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF3DC' } };
      cell.border = { top: { style: 'medium', color: { argb: 'FFE8B04B' } } };
    });
  }
  for (const note of r.notes) band(note, 9, false, 'FF475569');
  return Buffer.from(await wb.xlsx.writeBuffer());
}
