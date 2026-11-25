import { isNumeric, toDate } from './report-format';
import { esc, reportFontCss } from './report-html';
import { ReportColumnType } from './report.types';

/**
 * وثيقة تُعرض على مجلس المديرين (تقرير اعتماد أو تقرير تقييم أداء): غلاف بهوية الشركة،
 * وصفحة ضبط الوثيقة والمحتويات، ثم أقسام مرقمة (تبويبات) تبدأ كل منها بملخص ثم التفصيل، ثم صفحة القرار والتوقيعات.
 * كل قيمة تمر عبر esc()، والوثيقة مكتملة داخل HTML (الخط والشعار مضمّنان) فلا تحتاج أي طلب شبكي.
 */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';
/** paren: المبالغ السالبة بين قوسين كما في القوائم المالية */
export interface DocColumn { key: string; label: string; type?: ReportColumnType; width?: string; paren?: boolean }
export type DocRow = Record<string, unknown> & { _style?: 'strong' | 'muted' | 'group'; _level?: number; _tone?: Tone };

export type Block =
  | { t: 'p'; text: string; muted?: boolean }
  | { t: 'h'; text: string; note?: string }
  | { t: 'cards'; items: { label: string; value: unknown; type?: ReportColumnType; tone?: Tone; hint?: string }[] }
  | { t: 'kv'; items: { label: string; value: unknown; type?: ReportColumnType }[]; cols?: 1 | 2 }
  | { t: 'table'; columns: DocColumn[]; rows: DocRow[]; totals?: Record<string, unknown>; totalLabel?: string; empty?: string; small?: boolean; indent?: string }
  | { t: 'list'; items: string[]; tone?: Tone; numbered?: boolean; empty?: string }
  | { t: 'bars'; items: { label: string; value: number | null; ref?: number | null; tone?: Tone; text?: string }[]; refLabel?: string; valueLabel?: string }
  | { t: 'columns'; labels: string[]; series: { name: string; values: number[]; tone: Tone }[] }
  | { t: 'gantt'; year: number; items: { label: string; start: string | null; end: string | null; progress: number | null; tone?: Tone }[] }
  | { t: 'callout'; tone: Tone; title: string; text: string }
  | { t: 'lines'; label: string; count: number }
  | { t: 'decision'; options: string[] }
  | { t: 'signatures'; rows: { role: string; name: string | null; title?: string | null }[]; note?: string };

export interface DocSection { title: string; lead?: string; blocks: Block[]; newPage?: boolean }

export interface BoardDoc {
  /** رمز النموذج في وحدة الجودة، مثل QF-PLN-01 */
  formCode: string;
  /** رقم الوثيقة الصادرة (رمز النموذج مع رمز الخطة أو الموازنة والفترة) */
  docNo: string;
  kindLabel: string;
  title: string;
  subject: string;
  period: string;
  audience: string;
  organizationName: string;
  englishName: string | null;
  logo: string | null;
  colors: { primary: string; accent: string; dark: string };
  control: { label: string; value: unknown; type?: ReportColumnType }[];
  sections: DocSection[];
  generatedBy: string;
  generatedAt: string;
  classification: string;
  /** النظام المصدر في تذييل الغلاف (الافتراضي: نظام التخطيط والموازنات) */
  issuer?: string;
  /** علامة مائية على كل الصفحات (مثل «مسودة ــ الفترة غير مغلقة») */
  watermark?: string | null;
}

const TONE: Record<Tone, string> = { good: '#15803d', warn: '#b45309', bad: '#b91c1c', info: '#1d4ed8', neutral: '#475569' };
const TONE_BG: Record<Tone, string> = { good: '#ecfdf3', warn: '#fff7e6', bad: '#fef2f2', info: '#eff6ff', neutral: '#f4f6f5' };
const AR_NUM = ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠', '١١', '١٢', '١٣', '١٤', '١٥'];
const HEX = /^#[0-9a-f]{6}$/i;
const safeColor = (c: string | undefined, d: string) => (c && HEX.test(c) ? c : d);

/**
 * تنسيق قيم الوثيقة بأرقام لاتينية موحدة في النصوص والجداول (حتى لا تختلط الأرقام الهندية باللاتينية في الجملة الواحدة)،
 * والمبالغ مقربة لأقرب ريال عند العرض فقط.
 */
const moneyF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const numF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const dateF = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' });
const dtF = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Riyadh' });
export function fv(v: unknown, type: ReportColumnType = 'text'): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  switch (type) {
    case 'money': return Number.isFinite(n) ? moneyF.format(Math.round(n)) : String(v);
    case 'number': return Number.isFinite(n) ? numF.format(n) : String(v);
    case 'percent': return Number.isFinite(n) ? `${numF.format(n)}%` : String(v);
    case 'date': { const d = toDate(v); return d ? dateF.format(d) : String(v); }
    case 'datetime': { const d = toDate(v); return d ? dtF.format(d).replace(',', '') : String(v); }
    case 'bool': return v === true || v === 'true' ? 'نعم' : 'لا';
    default: return String(v);
  }
}
export const nowStamp = () => fv(new Date(), 'datetime');

export const fmt = (v: unknown, type: ReportColumnType = 'text', paren = false) => {
  if (paren && type === 'money' && v !== null && v !== undefined && v !== '' && Math.round(Number(v)) < 0) {
    return `<span class="nm">(${esc(moneyF.format(Math.abs(Math.round(Number(v)))))})</span>`;
  }
  const s = fv(v, type);
  if (s === '') return '<span class="dash">—</span>';
  // الأرقام باتجاه يسار-يمين معزول حتى تظهر إشارة السالب قبل الرقم داخل النص العربي
  return isNumeric(type) ? `<span class="nm">${esc(s)}</span>` : esc(s);
};

function table(b: Extract<Block, { t: 'table' }>) {
  if (!b.rows.length) return `<p class="empty">${esc(b.empty ?? 'لا توجد بنود')}</p>`;
  const head = b.columns.map((c) => `<th class="${isNumeric(c.type) ? 'n' : ''}"${c.width ? ` style="width:${esc(c.width)}"` : ''}>${esc(c.label)}</th>`).join('');
  const indent = b.indent ?? b.columns[0]?.key;
  const body = b.rows.map((r) => {
    const cls = [r._style ? `s-${r._style}` : '', r._tone ? `t-${r._tone}` : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}">${b.columns.map((c) => {
      const pad = c.key === indent && r._level ? ` style="padding-right:${7 + r._level * 12}px"` : '';
      return `<td class="${isNumeric(c.type) ? 'n' : ''}"${pad}>${fmt(r[c.key], c.type, c.paren)}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const totals = b.totals
    ? `<tr class="totals">${b.columns.map((c, i) => (b.totals![c.key] !== undefined ? `<td class="n">${fmt(b.totals![c.key], c.type, c.paren)}</td>` : `<td>${i === 0 ? esc(b.totalLabel ?? 'الإجمالي') : ''}</td>`)).join('')}</tr>`
    : '';
  return `<table class="${b.small ? 'small' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}${totals}</tbody></table>`;
}

function bars(b: Extract<Block, { t: 'bars' }>) {
  if (!b.items.length) return '<p class="empty">لا توجد بيانات</p>';
  const legend = `<div class="legend"><span><i class="lg-v"></i>${esc(b.valueLabel ?? 'الفعلي')}</span>${b.items.some((x) => x.ref !== undefined && x.ref !== null) ? `<span><i class="lg-r"></i>${esc(b.refLabel ?? 'المخطط')}</span>` : ''}</div>`;
  return `${legend}<div class="bars">${b.items.map((x) => {
    const v = Math.max(0, Math.min(100, Number(x.value) || 0));
    const ref = x.ref === undefined || x.ref === null ? null : Math.max(0, Math.min(100, Number(x.ref)));
    const tone = TONE[x.tone ?? 'good'];
    return `<div class="bar"><div class="bl">${esc(x.label)}</div><div class="bt"><div class="bf" style="width:${v}%;background:${tone}"></div>${ref !== null ? `<div class="br" style="right:${ref}%"></div>` : ''}</div><div class="bv">${x.text !== undefined ? `<span class="nm">${esc(x.text)}</span>` : x.value === null ? '<span class="dash">—</span>' : fmt(x.value, 'percent')}</div></div>`;
  }).join('')}</div>`;
}

function columnsChart(b: Extract<Block, { t: 'columns' }>) {
  const max = Math.max(1, ...b.series.flatMap((s) => s.values.map((v) => Math.abs(v))));
  const legend = `<div class="legend">${b.series.map((s) => `<span><i style="background:${TONE[s.tone]}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  const cols = b.labels.map((l, i) => `<div class="cc"><div class="cbars">${b.series.map((s) => `<div class="cb" style="height:${Math.round((Math.abs(s.values[i] ?? 0) / max) * 100)}%;background:${TONE[s.tone]}"></div>`).join('')}</div><div class="cl">${esc(l)}</div></div>`).join('');
  return `${legend}<div class="cchart">${cols}</div>`;
}

const MONTHS = ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
function gantt(b: Extract<Block, { t: 'gantt' }>) {
  if (!b.items.length) return '<p class="empty">لا توجد أنشطة مجدولة</p>';
  const head = `<th style="width:34%">النشاط</th>${MONTHS.map((m) => `<th class="g">${m}</th>`).join('')}<th class="n">الإنجاز</th>`;
  const body = b.items.map((x) => {
    const from = x.start ? (Number(x.start.slice(0, 4)) < b.year ? 1 : Number(x.start.slice(0, 4)) > b.year ? 13 : Number(x.start.slice(5, 7))) : null;
    const to = x.end ? (Number(x.end.slice(0, 4)) > b.year ? 12 : Number(x.end.slice(0, 4)) < b.year ? 0 : Number(x.end.slice(5, 7))) : null;
    const cells = MONTHS.map((_, i) => {
      const on = from !== null && to !== null && i + 1 >= from && i + 1 <= to;
      return `<td class="g">${on ? `<span class="gb" style="background:${TONE[x.tone ?? 'good']}"></span>` : ''}</td>`;
    }).join('');
    return `<tr><td>${esc(x.label)}</td>${cells}<td class="n">${fmt(x.progress, 'percent')}</td></tr>`;
  }).join('');
  return `<table class="small gantt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function block(b: Block): string {
  switch (b.t) {
    case 'p': return `<p class="${b.muted ? 'muted' : ''}">${esc(b.text)}</p>`;
    case 'h': return `<h3>${esc(b.text)}${b.note ? ` <small>${esc(b.note)}</small>` : ''}</h3>`;
    case 'cards': return `<div class="cards">${b.items.map((c) => `<div class="card"${c.tone ? ` style="border-top-color:${TONE[c.tone]}"` : ''}><span>${esc(c.label)}</span><b${c.tone ? ` style="color:${TONE[c.tone]}"` : ''}>${fmt(c.value, c.type ?? 'text')}</b>${c.hint ? `<em>${esc(c.hint)}</em>` : ''}</div>`).join('')}</div>`;
    case 'kv': return `<dl class="kv ${b.cols === 1 ? 'one' : ''}">${b.items.map((x) => `<div><dt>${esc(x.label)}</dt><dd>${fmt(x.value, x.type ?? 'text')}</dd></div>`).join('')}</dl>`;
    case 'table': return table(b);
    case 'list': {
      if (!b.items.length) return b.empty ? `<p class="muted">${esc(b.empty)}</p>` : '';
      const tag = b.numbered ? 'ol' : 'ul';
      return `<${tag} class="list ${b.tone ? `l-${b.tone}` : ''}">${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
    }
    case 'bars': return bars(b);
    case 'columns': return columnsChart(b);
    case 'gantt': return gantt(b);
    case 'callout': return `<div class="callout" style="border-color:${TONE[b.tone]};background:${TONE_BG[b.tone]}"><b style="color:${TONE[b.tone]}">${esc(b.title)}</b><p>${esc(b.text)}</p></div>`;
    case 'lines': return `<div class="lines"><b>${esc(b.label)}</b>${'<div class="ln"></div>'.repeat(Math.min(20, Math.max(1, b.count)))}</div>`;
    case 'decision': return `<div class="decision">${b.options.map((o) => `<div class="opt"><span class="box"></span>${esc(o)}</div>`).join('')}</div>`;
    case 'signatures': return `<table class="sign"><thead><tr><th style="width:24%">الصفة</th><th style="width:30%">الاسم</th><th>التوقيع</th><th style="width:16%">التاريخ</th></tr></thead><tbody>${b.rows.map((r) => `<tr><td><b>${esc(r.role)}</b>${r.title ? `<div class="muted">${esc(r.title)}</div>` : ''}</td><td>${r.name ? esc(r.name) : ''}</td><td></td><td></td></tr>`).join('')}</tbody></table>${b.note ? `<p class="muted">${esc(b.note)}</p>` : ''}`;
  }
}

export function renderBoardDoc(d: BoardDoc, opts: { print?: boolean } = {}) {
  const primary = safeColor(d.colors.primary, '#164e38');
  const accent = safeColor(d.colors.accent, '#c7a27a');
  const dark = safeColor(d.colors.dark, '#0f2e22');
  const logo = d.logo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d.logo) ? `<img class="logo" src="${d.logo}" alt="">` : `<div class="logo-text">${esc(d.organizationName)}</div>`;
  const toc = d.sections.map((s, i) => `<li><span class="num">${AR_NUM[i] ?? i + 1}</span><span class="tt">${esc(s.title)}</span>${s.lead ? `<span class="muted">${esc(s.lead)}</span>` : ''}</li>`).join('');
  const sections = d.sections.map((s, i) => `
<section class="sec${s.newPage === false ? '' : ' np'}">
  <div class="tab"><span class="num">${AR_NUM[i] ?? i + 1}</span><h2>${esc(s.title)}</h2><span class="code">${esc(d.docNo)}</span></div>
  ${s.lead ? `<p class="lead">${esc(s.lead)}</p>` : ''}
  ${s.blocks.map(block).join('\n')}
</section>`).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(d.docNo)} ${esc(d.title)}</title>
<style>
${reportFontCss()}
@page { size: A4 portrait; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Plex Arabic', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', Tahoma, sans-serif; color: #1f2a24; font-size: 10.5px; line-height: 1.65;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cover { height: 262mm; display: flex; flex-direction: column; border: 1.5px solid ${primary}; border-radius: 14px; overflow: hidden; break-after: page; page-break-after: always; }
.cover .top { padding: 26px 30px 18px; display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${accent}; }
.logo { height: 62px; } .logo-text { font-size: 20px; font-weight: 700; color: ${primary}; }
.cover .form { text-align: left; font-size: 10px; color: #64748b; } .cover .form b { display: block; font-size: 14px; color: ${primary}; letter-spacing: .5px; }
.cover .mid { flex: 1; padding: 40px 34px; display: flex; flex-direction: column; justify-content: center; background: linear-gradient(160deg, #fff 0%, #f3ede6 100%); }
.cover .kind { display: inline-block; align-self: flex-start; background: ${accent}; color: ${dark}; font-weight: 700; padding: 3px 14px; border-radius: 999px; font-size: 11px; }
.cover h1 { font-size: 27px; color: ${primary}; margin: 16px 0 6px; line-height: 1.35; }
.cover .subject { font-size: 15px; font-weight: 600; color: #2c3e33; }
.cover .period { margin-top: 6px; font-size: 12px; color: #475569; }
.cover .meta { margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 22px; max-width: 520px; }
.cover .meta div { border-right: 3px solid ${accent}; padding-right: 9px; } .cover .meta span { display: block; font-size: 9.5px; color: #64748b; } .cover .meta b { font-size: 11.5px; }
.cover .bottom { background: ${dark}; color: #f3ede6; padding: 12px 30px; display: flex; justify-content: space-between; font-size: 9.5px; }
.ctrl { break-after: page; page-break-after: always; }
h2 { margin: 0; font-size: 15px; }
.tab { display: flex; align-items: center; gap: 10px; background: ${primary}; color: #fff; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; }
.tab .num, .toc .num { display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; border-radius: 8px; background: ${accent}; color: ${dark}; font-weight: 700; font-size: 13px; }
.tab h2 { flex: 1; } .tab .code { font-size: 9px; opacity: .8; }
.np { break-before: page; page-break-before: always; }
.lead { margin: 0 2px 10px; color: #334155; font-size: 11px; }
h3 { color: ${primary}; font-size: 12.5px; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid ${accent}; break-after: avoid; page-break-after: avoid; }
h3 small { color: #64748b; font-weight: 400; font-size: 9.5px; }
p { margin: 4px 0 8px; } .muted { color: #64748b; font-size: 9.5px; }
.toc { list-style: none; padding: 0; margin: 6px 0 0; } .toc li { display: flex; gap: 10px; align-items: center; padding: 7px 4px; border-bottom: 1px dashed #d6ddd9; }
.toc .tt { font-weight: 600; font-size: 11.5px; min-width: 210px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; margin: 6px 0 10px; }
.card { border: 1px solid #e2e8e4; border-top: 3px solid ${accent}; border-radius: 9px; padding: 7px 10px; background: #fbfcfb; break-inside: avoid; }
.card > span { display: block; color: #64748b; font-size: 9.3px; } .card b { font-size: 13.5px; } .card em { display: block; font-style: normal; color: #64748b; font-size: 8.8px; }
.kv { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; margin: 4px 0 10px; } .kv.one { grid-template-columns: 1fr; }
.kv div { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid #eef1ef; break-inside: avoid; } .kv dt { color: #64748b; min-width: 110px; } .kv dd { margin: 0; font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; } thead { display: table-header-group; } tr { break-inside: avoid; page-break-inside: avoid; }
th { background: ${primary}; color: #fff; font-weight: 600; font-size: 9.5px; padding: 5px 6px; text-align: right; border: 1px solid ${primary}; }
td { padding: 4px 6px; border: 1px solid #e2e8e4; vertical-align: top; } tbody tr:nth-child(even) td { background: #f8faf9; }
table.small td, table.small th { font-size: 9px; padding: 3px 5px; }
.n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; } th.n { text-align: center; }
.dash { color: #b6c0ca; } .nm { direction: ltr; unicode-bidi: isolate; display: inline-block; }
tr.s-strong td { font-weight: 700; background: #edf4f0 !important; } tr.s-group td { font-weight: 700; background: #f6efe6 !important; color: ${dark}; } tr.s-muted td { color: #64748b; }
tr.t-bad td:first-child { border-right: 3px solid ${TONE.bad}; } tr.t-warn td:first-child { border-right: 3px solid ${TONE.warn}; } tr.t-good td:first-child { border-right: 3px solid ${TONE.good}; }
tr.totals td { font-weight: 700; background: #f6efe6 !important; border-top: 2px solid ${accent}; }
.empty { text-align: center; color: #64748b; padding: 14px; border: 1px dashed #cbd5e1; border-radius: 9px; }
.list { margin: 4px 0 10px; padding-right: 18px; } .list li { margin: 2px 0; }
.l-bad li::marker { color: ${TONE.bad}; } .l-warn li::marker { color: ${TONE.warn}; } .l-good li::marker { color: ${TONE.good}; }
.legend { display: flex; gap: 14px; font-size: 9px; color: #475569; margin: 2px 0 6px; } .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-left: 4px; vertical-align: -1px; background: ${TONE.good}; }
.legend .lg-r { background: none; border-right: 2px solid ${dark}; border-radius: 0; width: 4px; }
.bars { margin: 2px 0 10px; } .bar { display: flex; align-items: center; gap: 8px; margin: 4px 0; break-inside: avoid; }
.bl { width: 36%; font-size: 9.6px; } .bt { flex: 1; position: relative; height: 11px; background: #edf1ee; border-radius: 6px; overflow: visible; }
.bf { position: absolute; top: 0; right: 0; height: 100%; border-radius: 6px; } .br { position: absolute; top: -3px; width: 2px; height: 17px; background: ${dark}; }
.bv { min-width: 52px; text-align: left; font-weight: 600; font-size: 9.6px; white-space: nowrap; }
.cchart { display: flex; align-items: flex-end; gap: 4px; height: 120px; border-bottom: 1px solid #cbd5e1; margin: 4px 0 18px; padding: 0 2px; }
.cc { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; position: relative; }
.cbars { display: flex; align-items: flex-end; gap: 1px; height: 100%; } .cb { flex: 1; min-height: 1px; border-radius: 2px 2px 0 0; }
.cl { position: absolute; bottom: -15px; width: 100%; text-align: center; font-size: 8px; color: #64748b; }
.callout { border-right: 4px solid; border-radius: 8px; padding: 7px 11px; margin: 6px 0 10px; break-inside: avoid; } .callout p { margin: 2px 0 0; }
.lines { margin: 8px 0 12px; } .lines .ln { border-bottom: 1px solid #cbd5e1; height: 22px; }
.decision { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 6px 0 12px; } .opt { display: flex; gap: 8px; align-items: center; font-weight: 600; }
.box { width: 14px; height: 14px; border: 1.5px solid ${primary}; border-radius: 3px; display: inline-block; }
table.gantt th.g, table.gantt td.g { width: 3.6%; padding: 2px 1px; text-align: center; } .gb { display: block; height: 9px; border-radius: 2px; }
table.sign td { height: 34px; vertical-align: middle; }
.wm { position: fixed; top: 45%; left: 0; right: 0; text-align: center; transform: rotate(-28deg); font-size: 54px; font-weight: 700; color: rgba(185, 28, 28, .10); z-index: 0; pointer-events: none; }
${opts.print ? '@media screen { body { padding: 16px; background: #fff; } }' : ''}
</style></head>
<body>
${d.watermark ? `<div class="wm">${esc(d.watermark)}</div>` : ''}
<div class="cover">
  <div class="top">${logo}<div class="form">رمز النموذج<b>${esc(d.formCode)}</b></div></div>
  <div class="mid">
    <span class="kind">${esc(d.kindLabel)}</span>
    <h1>${esc(d.title)}</h1>
    <div class="subject">${esc(d.subject)}</div>
    <div class="period">${esc(d.period)}</div>
    <div class="meta">
      <div><span>مقدم إلى</span><b>${esc(d.audience)}</b></div>
      <div><span>رقم الوثيقة</span><b>${esc(d.docNo)}</b></div>
      <div><span>تاريخ الإصدار</span><b>${esc(d.generatedAt)}</b></div>
      <div><span>التصنيف</span><b>${esc(d.classification)}</b></div>
    </div>
  </div>
  <div class="bottom"><span>${esc(d.organizationName)}${d.englishName ? ` · ${esc(d.englishName)}` : ''}</span><span>${esc(d.issuer ?? 'صادر من نظام التخطيط والموازنات')}</span></div>
</div>
<div class="ctrl">
  <div class="tab"><span class="num">◆</span><h2>ضبط الوثيقة والمحتويات</h2><span class="code">${esc(d.docNo)}</span></div>
  <dl class="kv">${d.control.map((x) => `<div><dt>${esc(x.label)}</dt><dd>${fmt(x.value, x.type ?? 'text')}</dd></div>`).join('')}</dl>
  <h3>محتويات التقرير</h3>
  <ol class="toc">${toc}</ol>
  <p class="muted">الأرقام في هذا التقرير تُولّد من بيانات النظام وقت الإصدار، ويُعاد إصدار التقرير من النظام عند أي تحديث. المبالغ بالريال السعودي مقربة لأقرب ريال.</p>
</div>
${sections}
</body></html>`;
}
