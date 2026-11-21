import { readFileSync } from 'fs';
import { formatValue, isNumeric } from './report-format';
import { ReportOutput, ReportRow } from './report.types';

/**
 * قالب HTML موحد لكل التقارير: يُستخدم لملف PDF وللطباعة.
 * الخط العربي (IBM Plex Sans Arabic) مضمّن داخل الملف نفسه، فلا يعتمد على خطوط الخادم.
 */
let fontCss: string | null = null;
export function reportFontCss() {
  if (fontCss !== null) return fontCss;
  const faces: string[] = [];
  for (const weight of [400, 600, 700]) {
    for (const subset of ['arabic', 'latin']) {
      try {
        const file = require.resolve(`@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`);
        const data = readFileSync(file).toString('base64');
        const range = subset === 'arabic'
          ? 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EEFF'
          : 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
        faces.push(`@font-face{font-family:'Plex Arabic';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range};}`);
      } catch {
        // بدون الخط المضمن يُستخدم خط النظام
      }
    }
  }
  fontCss = faces.join('\n');
  return fontCss;
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function cell(r: ReportRow, key: string, type: Parameters<typeof formatValue>[1]) {
  const v = formatValue(r[key], type);
  return v === '' ? '<span class="dash">—</span>' : esc(v);
}

export function renderReportHtml(r: ReportOutput, opts: { print?: boolean } = {}) {
  const cols = r.columns;
  const head = cols.map((c) => `<th class="${isNumeric(c.type) ? 'n' : ''}">${esc(c.label)}</th>`).join('');
  const body = r.rows.map((row) => {
    const cls = [row._style ? `s-${row._style}` : ''].filter(Boolean).join(' ');
    const indent = r.indentColumn ?? cols[0]?.key;
    const tds = cols.map((c) => {
      const pad = c.key === indent && row._level ? ` style="padding-right:${8 + Math.max(0, row._level - 1) * 12}px"` : '';
      return `<td class="${isNumeric(c.type) ? 'n' : ''}"${pad}>${cell(row, c.key, c.type)}</td>`;
    }).join('');
    return `<tr class="${cls}">${tds}</tr>`;
  }).join('');
  const totals = r.totals && r.rows.length
    ? `<tr class="totals">${cols.map((c, i) => {
      if (r.totals![c.key] !== undefined) return `<td class="n">${esc(formatValue(r.totals![c.key], c.type))}</td>`;
      return `<td>${i === 0 ? 'الإجمالي' : ''}</td>`;
    }).join('')}</tr>`
    : '';
  const summary = r.summary.length
    ? `<div class="summary">${r.summary.map((s) => `<div class="kpi"><span>${esc(s.label)}</span><b>${esc(formatValue(s.value, s.type ?? 'text') || '—')}</b></div>`).join('')}</div>`
    : '';
  const filters = r.appliedFilters.map((f) => `<span class="chip"><i>${esc(f.label)}:</i> ${esc(f.value)}</span>`).join('');
  const notes = r.notes.length ? `<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  const empty = r.rows.length ? '' : '<p class="empty">لا توجد بيانات تطابق الفلاتر المختارة</p>';
  const landscape = r.orientation === 'landscape';

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(r.title)}</title>
<style>
${reportFontCss()}
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm 10mm 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Plex Arabic', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Noto Naskh Arabic', Tahoma, sans-serif; color: #1b2733; font-size: 10.5px; line-height: 1.55;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 14px 18px; border-radius: 12px;
  background: linear-gradient(135deg, #0f766e, #0d9488 60%, #14b8a6); color: #fff; }
.head .org { font-size: 11px; opacity: .9; font-weight: 600; }
.head h1 { margin: 2px 0 2px; font-size: 19px; font-weight: 700; }
.head p { margin: 0; font-size: 10.5px; opacity: .88; }
.brand { text-align: left; white-space: nowrap; font-size: 10px; opacity: .92; }
.brand b { display: block; font-size: 15px; color: #fde7b0; letter-spacing: .5px; }
.sub { margin: 8px 2px 0; font-weight: 600; font-size: 11.5px; color: #0f766e; }
.meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 8px; }
.chip { background: #f1f5f4; border: 1px solid #dbe5e3; border-radius: 999px; padding: 2px 10px; font-size: 9.5px; }
.chip i { font-style: normal; color: #64748b; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 6px 0 10px; }
.kpi { border: 1px solid #e3e8ec; border-radius: 10px; padding: 7px 10px; background: #fbfdfc; border-top: 3px solid #e8b04b; }
.kpi span { display: block; color: #64748b; font-size: 9.5px; }
.kpi b { font-size: 13px; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th { background: #0f766e; color: #fff; font-weight: 600; font-size: 9.8px; padding: 6px 7px; text-align: right; border: 1px solid #0f766e; }
td { padding: 4.5px 7px; border: 1px solid #e3e8ec; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f8fafb; }
.n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
th.n { text-align: center; }
.dash { color: #b6c0ca; }
tr.s-strong td { font-weight: 700; background: #eef6f5 !important; }
tr.s-group td { font-weight: 700; background: #fdf6e7 !important; color: #8a5a00; }
tr.s-muted td { color: #64748b; }
tr.totals td { font-weight: 700; background: #fdf3dc !important; border-top: 2px solid #e8b04b; }
.empty { text-align: center; color: #64748b; padding: 30px; border: 1px dashed #cbd5e1; border-radius: 10px; }
.notes { margin: 10px 0 0; padding-right: 18px; color: #475569; font-size: 9.5px; }
.foot { margin-top: 12px; display: flex; justify-content: space-between; color: #94a3b8; font-size: 9px; border-top: 1px solid #e3e8ec; padding-top: 6px; }
${opts.print ? '@media screen { body { padding: 16px; background: #fff; } }' : ''}
</style></head>
<body>
<header class="head">
  <div>
    ${r.organizationName ? `<div class="org">${esc(r.organizationName)}</div>` : ''}
    <h1>${esc(r.title)}</h1>
    <p>${esc(r.description)}</p>
  </div>
  <div class="brand"><b>رعاية وطن</b>National Care</div>
</header>
${r.subtitle ? `<div class="sub">${esc(r.subtitle)}</div>` : ''}
<div class="meta">${filters}<span class="chip"><i>عدد السطور:</i> ${esc(formatValue(r.rows.length, 'number') || '٠')}</span></div>
${summary}
${r.rows.length ? `<table><thead><tr>${head}</tr></thead><tbody>${body}${totals}</tbody></table>` : empty}
${notes}
<div class="foot"><span>أُعد بواسطة: ${esc(r.generatedBy)}</span><span>تاريخ الإصدار: ${esc(r.generatedAt)}</span></div>
</body></html>`;
}
