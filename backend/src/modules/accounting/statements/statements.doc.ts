import { Block, BoardDoc, DocColumn, DocRow, DocSection, nowStamp } from '../../../core/reports/board-doc';
import { BOARD_ROLE, BOARD_ROLE_ORDER, BoardBody, DocBrand } from '../../../core/reports/doc-brand';
import { COMPANY_BRAND } from '../../../core/identity/company-brand';
import { DEP_METHOD_AR } from '../depreciation';
import { FS_LINE, NONPROFIT_CHANNELS } from './fs-template';
import { dmy } from './fs-period';
import type { StatementsService, StatementRow } from './statements.service';

type Computed = Awaited<ReturnType<StatementsService['compute']>>;
type Partners = Awaited<ReturnType<StatementsService['partners']>>;
type Dep = Awaited<ReturnType<StatementsService['depreciation']>>;
type Approp = { inputs: { programs: { channel: number; name: string; amount: number }[]; boardDecision: string | null; notes: string | null; developmentPct: number; distributionPct: number; reserveMonths: number }; result: ReturnType<StatementsService['calcAppropriation']> } | null;
type MapRow = { code: string; name: string; kind: string; isActive: boolean; line: string; lineName: string; source: string; via: string | null };

export const FS_FORM = { code: 'QF-FIN-07', title: 'ملف القوائم المالية', purpose: 'القوائم المالية والإيضاحات المتممة وملاحقها التفصيلية، تُرفع للمراجع الخارجي ومجلس المديرين للاعتماد' };

const SOURCE_AR: Record<string, string> = { manual: 'يدوي', inherited: 'موروث من الأب', default: 'افتراضي', fallback: 'غير مصنف' };
const money = (key: string, label: string): DocColumn => ({ key, label, type: 'money', paren: true });

export interface FsDocInput {
  st: Computed;
  customers: Partners;
  suppliers: Partners;
  dep: Dep;
  appropriation: Approp;
  mapping: MapRow[];
  brand: DocBrand;
  board: BoardBody | null;
  actorName: string;
  /** رقم الإصدار النهائي، أو null للمعاينة */
  issueNo: number | null;
  closed: boolean;
}

export function buildStatementsDoc(x: FsDocInput): BoardDoc {
  const { st } = x;
  const p = st.period;
  const curLabel = `${dmy(p.to)}`;
  const cmpLabel = st.comparative ? dmy(st.comparative.end) : 'المقارنة';
  const hasCmp = !!st.comparative;
  const noteCol: DocColumn = { key: 'note', label: 'إيضاح', type: 'text', width: '7%' };
  const lineRows = (rs: StatementRow[], ytd = false): DocRow[] => rs.map((r) => ({ name: r.name, note: r.note ?? '', cur: r.cur, cmp: r.cmp, ...(ytd ? { ytd: r.ytd } : {}), _level: 1 }));

  // ---------- ١ قائمة المركز المالي ----------
  const bsCols: DocColumn[] = [{ key: 'name', label: 'البند' }, noteCol, money('cur', `كما في ${curLabel}`), ...(hasCmp ? [money('cmp', `كما في ${cmpLabel}`)] : [])];
  const g = (k: string) => st.bs.groups.find((x) => x.key === k)!;
  const grp = (k: string, title?: string): DocRow[] => (!g(k).rows.length ? [] : [
    { name: title ?? g(k).name, _style: 'group' },
    ...lineRows(g(k).rows),
    { name: `مجموع ${g(k).name}`, cur: g(k).total.cur, cmp: g(k).total.cmp, _style: 'strong' },
  ]);
  const bsRows: DocRow[] = [
    { name: 'الأصول', _style: 'group' }, ...grp('ca'), ...grp('nca'),
    { name: 'مجموع الأصول', cur: st.bs.totalAssets.cur, cmp: st.bs.totalAssets.cmp, _style: 'strong' },
    { name: 'الالتزامات وحقوق الملكية', _style: 'group' }, ...grp('cl'), ...grp('ncl'),
    { name: 'مجموع الالتزامات', cur: st.bs.totalLiabilities.cur, cmp: st.bs.totalLiabilities.cmp, _style: 'strong' },
    ...grp('eq'),
    { name: 'مجموع الالتزامات وحقوق الملكية', cur: st.bs.totalLiabEquity.cur, cmp: st.bs.totalLiabEquity.cmp, _style: 'strong' },
  ];

  // ---------- ٢ قائمة الدخل ----------
  const ytd = st.is.showYtd;
  const isCols: DocColumn[] = [
    { key: 'name', label: 'البند' }, noteCol, money('cur', p.range.replace('للفترة ', '')),
    ...(ytd ? [money('ytd', `من بداية السنة حتى ${curLabel}`)] : []),
    ...(hasCmp ? [money('cmp', `المقارنة ${dmy(st.comparative!.from)} – ${dmy(st.comparative!.to)}`)] : []),
  ];
  const isRows: DocRow[] = st.is.sections.flatMap((s) => ('rows' in s && s.rows
    ? (s.rows.length ? [{ name: s.name, _style: 'group' } as DocRow, ...lineRows(s.rows, ytd)] : [])
    : [{ name: s.name, cur: s.subtotal!.cur, cmp: s.subtotal!.cmp, ...(ytd ? { ytd: s.subtotal!.ytd } : {}), _style: 'strong' } as DocRow]));

  // ---------- ٣ التغيرات في حقوق الملكية ----------
  const eqCols: DocColumn[] = [{ key: 'label', label: 'البيان' }, ...st.equity.columns.map((c, i) => money(`c${i}`, c.name)), money('total', 'الإجمالي')];
  const eqRows: DocRow[] = st.equity.rows.map((r, i) => ({
    label: r.label, ...Object.fromEntries(r.values.map((v, j) => [`c${j}`, v])), total: Math.round(r.values.reduce((t, v) => t + v * 100, 0)) / 100,
    ...(i === 0 || i === st.equity.rows.length - 1 ? { _style: 'strong' as const } : {}),
  }));

  // ---------- ٤ التدفقات النقدية ----------
  const c = st.cash;
  const cfRows: DocRow[] = [
    { name: 'التدفقات النقدية من الأنشطة التشغيلية', _style: 'group' },
    { name: 'صافي ربح (خسارة) الفترة', amount: c.netIncome, _level: 1 },
    { name: 'تعديلات: الإهلاك والإطفاء', amount: c.depreciation, _level: 1 },
    ...c.operating.map((r) => ({ name: r.name, amount: r.amount, _level: 1 })),
    { name: 'صافي النقد من الأنشطة التشغيلية', amount: c.operatingTotal, _style: 'strong' },
    { name: 'التدفقات النقدية من الأنشطة الاستثمارية', _style: 'group' },
    ...c.investing.map((r) => ({ name: r.name, amount: r.amount, _level: 1 })),
    { name: 'صافي النقد من الأنشطة الاستثمارية', amount: c.investingTotal, _style: 'strong' },
    { name: 'التدفقات النقدية من الأنشطة التمويلية', _style: 'group' },
    ...c.financing.map((r) => ({ name: r.name, amount: r.amount, _level: 1 })),
    { name: 'صافي النقد من الأنشطة التمويلية', amount: c.financingTotal, _style: 'strong' },
    { name: 'صافي التغير في النقد وما في حكمه', amount: c.netChange, _style: 'strong' },
    { name: 'النقد وما في حكمه أول الفترة', amount: c.cashStart },
    { name: 'النقد وما في حكمه آخر الفترة', amount: c.cashEnd, _style: 'strong' },
  ];

  // ---------- ٥ الإيضاحات ----------
  const notes: Block[] = [
    { t: 'h', text: '1. التكوين والنشاط' },
    { t: 'p', text: `${x.brand.organizationName}: ${COMPANY_BRAND.about}` },
    { t: 'kv', items: [{ label: 'السجل التجاري', value: COMPANY_BRAND.licenseNo }, { label: 'الرقم الضريبي', value: COMPANY_BRAND.taxNumber }, { label: 'المقر الرئيس', value: COMPANY_BRAND.contact.city }, { label: 'الفترة', value: `${p.label} ${p.range}` }] },
    { t: 'h', text: '2. أسس الإعداد' },
    { t: 'list', items: [
      'أُعدت القوائم المالية وفق المعيار الدولي للتقرير المالي للمنشآت الصغيرة والمتوسطة المعتمد في المملكة العربية السعودية، والمعايير والإصدارات الأخرى المعتمدة من الهيئة السعودية للمراجعين والمحاسبين.',
      'أُعدت على أساس التكلفة التاريخية ومبدأ الاستحقاق، وتُعرض بالريال السعودي وهو عملة النشاط، مقربة لأقرب ريال.',
      'الأرقام مستخرجة آليًا من القيود المرحّلة في النظام المالي للشركة، وكل حساب في الدليل مربوط ببند في القوائم (الملحق «الدليل المحاسبي وفق بنود القوائم»).',
      ...(hasCmp ? [`أرقام المقارنة: المركز المالي كما في ${dmy(st.comparative!.end)}، والدخل لنفس الفترة من السنة المالية ${st.comparative!.year}.`] : ['لا توجد أرقام مقارنة لأن الفترة من السنة المالية الأولى للشركة في النظام.']),
    ] },
    { t: 'h', text: '3. السياسات المحاسبية الهامة' },
    { t: 'list', items: [
      ...st.notesIndex.filter((n) => n.policy).map((n) => `${n.name}: ${n.policy}`),
      'ضريبة القيمة المضافة: تُسجل الإيرادات والمصروفات صافية من الضريبة، ويُعرض صافي المستحق للهيئة ضمن الالتزامات المتداولة.',
      'الزكاة وضريبة الدخل: تُثبت وفق الوضع النظامي للشركة كشركة غير ربحية، ويُعرض ما يُستحق منها إن وجد في بند مستقل.',
      'الإيرادات والمصروفات تُثبت على أساس الاستحقاق، والمصروفات المباشرة للخدمات والمشاريع والتدريب تُعرض ضمن تكلفة الإيرادات.',
    ] },
  ];
  const accCols: DocColumn[] = [{ key: 'code', label: 'رقم الحساب', width: '16%' }, { key: 'name', label: 'الحساب' }, money('cur', curLabel), ...(hasCmp ? [money('cmp', cmpLabel)] : [])];
  for (const n of st.notesIndex) {
    notes.push({ t: 'h', text: `${n.no}. ${n.name}` });
    notes.push({ t: 'table', small: true, columns: accCols, rows: n.accounts.map((a) => ({ code: a.code, name: a.name, cur: a.cur, cmp: a.cmp })),
      totals: { cur: sumBy(n.accounts, 'cur'), ...(hasCmp ? { cmp: sumBy(n.accounts, 'cmp') } : {}) } });
    if (n.code === 'BS-NCA-PPE' || n.code === 'BS-NCA-INT') {
      if (x.dep.groups.length) {
        notes.push({ t: 'p', muted: true, text: 'حركة الأصول ومجمع إهلاكها حسب المجموعة من بداية السنة حتى نهاية الفترة (التفصيل لكل أصل في ملحق تحليل الإهلاك):' });
        notes.push({ t: 'table', small: true, columns: depCols(false), rows: x.dep.groups.map((gr) => ({ name: gr.name, ...pick(gr) })), totals: pick(x.dep.total) });
      }
    }
    if (n.code === 'BS-CA-AR' && x.customers.rows.length) {
      notes.push({ t: 'p', muted: true, text: 'أعمار أرصدة العملاء في نهاية الفترة (التفصيل في ملحق تحليل العملاء):' });
      notes.push({ t: 'table', small: true, columns: x.customers.buckets.map((b) => money(b.key, b.label)), rows: [Object.fromEntries(x.customers.buckets.map((b) => [b.key, x.customers.totals[b.key]]))] });
    }
    if (n.code === 'BS-CL-AP' && x.suppliers.rows.length) {
      notes.push({ t: 'p', muted: true, text: 'أعمار أرصدة الموردين في نهاية الفترة (التفصيل في ملحق تحليل الموردين):' });
      notes.push({ t: 'table', small: true, columns: x.suppliers.buckets.map((b) => money(b.key, b.label)), rows: [Object.fromEntries(x.suppliers.buckets.map((b) => [b.key, x.suppliers.totals[b.key]]))] });
    }
    if (n.code === 'BS-CA-RP' || n.code === 'BS-CL-RP') {
      notes.push({ t: 'p', muted: true, text: 'الجهات ذات العلاقة: العضو الوحيد المالك (جمعية عناية) ومجلس المديرين والإدارة العليا. تتم المعاملات معها وفق سياسة تنظيم العلاقة مع جمعية عناية POL-PRT-01.' });
    }
  }
  let nextNote = (st.notesIndex.at(-1)?.no ?? 3) + 1;
  if (x.appropriation && p.endsYear) {
    notes.push({ t: 'h', text: `${nextNote++}. مشروع تخصيص الأرباح` });
    notes.push({ t: 'p', text: `يقترح مجلس المديرين تخصيص الأرباح القابلة للتخصيص البالغة ${fmtMoney(x.appropriation.result.distributable)} ريال وفق المادة (10) من النظام الأساس وسياسة تخصيص الأرباح POL-FIN-03، والتفصيل في ملحق مشروع توزيع الأرباح. ${x.appropriation.inputs.boardDecision ? `قرار المجلس: ${x.appropriation.inputs.boardDecision}.` : 'لم يصدر قرار المجلس بعد.'}` });
  }
  notes.push({ t: 'h', text: `${nextNote++}. الأحداث اللاحقة` });
  notes.push({ t: 'p', text: 'لم تقع أحداث لاحقة لتاريخ القوائم المالية تستوجب التعديل أو الإفصاح حتى تاريخ اعتمادها، ما لم يُذكر خلاف ذلك أدناه.' });
  notes.push({ t: 'lines', label: 'الأحداث اللاحقة (إن وجدت)', count: 3 });
  notes.push({ t: 'h', text: `${nextNote++}. اعتماد القوائم المالية` });
  notes.push({ t: 'p', text: 'اعتمد مجلس المديرين هذه القوائم المالية بتاريخ ..... / ..... / .......... بالقرار رقم ....................' });

  // ---------- الملاحق ----------
  const depAssetRows: DocRow[] = x.dep.groups.flatMap((gr) => [
    { name: `${gr.name} (${gr.count} أصل) · ${DEP_METHOD_AR[gr.method as keyof typeof DEP_METHOD_AR] ?? gr.method} ${gr.rate}%`, ...pick(gr), _style: 'group' as const },
    ...gr.assets.map((a) => ({ name: `${a.code} ${a.name}`, date: a.inServiceDate, ...pick(a), _level: 1 })),
  ]);
  const ppeGl = (st.bs.groups.find((x) => x.key === 'nca')?.rows ?? []).filter((r) => r.code === 'BS-NCA-PPE' || r.code === 'BS-NCA-INT').reduce((t, r) => t + Math.round(r.cur * 100), 0) / 100;
  const depDiff = Math.round((ppeGl - x.dep.total.nbv) * 100) / 100;

  const partnerCols = (pp: Partners): DocColumn[] => [
    { key: 'no', label: 'الرقم', width: '6%' }, { key: 'name', label: pp.behavior === 'customer' ? 'العميل' : 'المورد' },
    money('opening', 'رصيد أول السنة'), money('increase', pp.behavior === 'customer' ? 'المبيعات والمدين' : 'المشتريات والدائن'),
    money('decrease', pp.behavior === 'customer' ? 'المحصّل والدائن' : 'المسدد والمدين'), money('balance', 'الرصيد آخر الفترة'),
    ...pp.buckets.map((b) => money(b.key, b.label)),
  ];
  const partnerRows = (pp: Partners): DocRow[] => pp.rows.map((r) => ({ ...r, no: r.partnerNo, name: `${r.name}${r.overLimit ? ' (تجاوز الحد الائتماني)' : ''}`, _tone: r.overLimit ? 'bad' as const : undefined }));
  const partnerTotals = (pp: Partners) => Object.fromEntries(['opening', 'increase', 'decrease', 'balance', ...pp.buckets.map((b) => b.key)].map((k) => [k, pp.totals[k]]));
  const arGl = sumLine(st, 'BS-CA-AR'), apGl = sumLine(st, 'BS-CL-AP');

  const sections: DocSection[] = [
    { title: 'قائمة المركز المالي', lead: `كما في ${curLabel} (بالريال السعودي)`, blocks: [
      ...checkBlocks(st),
      { t: 'table', columns: bsCols, rows: bsRows, indent: 'name' },
      { t: 'p', muted: true, text: 'الإيضاحات المرفقة جزء لا يتجزأ من هذه القوائم المالية.' },
    ] },
    { title: 'قائمة الدخل', lead: `${p.label} ${p.range}`, blocks: [
      { t: 'table', columns: isCols, rows: isRows, indent: 'name' },
      { t: 'p', muted: true, text: 'المبالغ بين قوسين مصروفات أو خسائر.' },
    ] },
    { title: 'قائمة التغيرات في حقوق الملكية', lead: p.range, blocks: [
      { t: 'table', columns: eqCols, rows: eqRows },
      { t: 'p', muted: true, text: 'عمود الأرباح المبقاة يشمل صافي الربح من بداية السنة حتى أول الفترة.' },
    ] },
    { title: 'قائمة التدفقات النقدية', lead: `${p.range} (الطريقة غير المباشرة)`, blocks: [
      { t: 'table', columns: [{ key: 'name', label: 'البيان' }, money('amount', 'المبلغ')], rows: cfRows, indent: 'name' },
      ...(c.difference ? [{ t: 'callout' as const, tone: 'bad' as const, title: 'فرق في التدفقات النقدية', text: `صافي التدفقات لا يطابق التغير في النقد بفرق ${fmtMoney(c.difference)}. راجع ربط الحسابات ببنود القوائم وتصنيفها.` }] : []),
    ] },
    { title: 'الإيضاحات المتممة للقوائم المالية', lead: `${p.label} ${p.range}`, blocks: notes },
    { title: 'ملحق: تحليل الإهلاك التفصيلي', lead: `حركة كل أصل من ${dmy(p.yearStart)} حتى ${curLabel}، مع المطابقة مع الدليل`, blocks: [
      { t: 'cards', items: [
        { label: 'صافي القيمة في سجل الأصول', value: x.dep.total.nbv, type: 'money' },
        { label: 'صافي القيمة في القوائم (الدليل)', value: ppeGl, type: 'money' },
        { label: 'الفرق', value: depDiff, type: 'money', tone: depDiff ? 'bad' : 'good', hint: depDiff ? 'يحتاج مطابقة قبل الاعتماد' : 'مطابق' },
        { label: 'إهلاك الفترة من بداية السنة', value: x.dep.total.depreciation, type: 'money' },
      ] },
      { t: 'table', small: true, columns: depCols(true), rows: depAssetRows, totals: pick(x.dep.total), indent: 'name', empty: 'لا توجد أصول ثابتة مسجلة في سجل الأصول' },
    ] },
    { title: 'ملحق: تحليل العملاء', lead: `أرصدة العملاء وحركتهم من بداية السنة وأعمار الأرصدة كما في ${curLabel}`, blocks: [
      { t: 'cards', items: [
        { label: 'مجموع أرصدة العملاء', value: x.customers.totals.balance, type: 'money' },
        { label: 'بند الذمم المدينة التجارية في القوائم', value: arGl, type: 'money' },
        { label: 'دفعات مقدمة (أرصدة دائنة)', value: x.customers.totals.advance, type: 'money' },
        { label: 'عدد العملاء', value: x.customers.rows.length, type: 'number' },
      ] },
      { t: 'table', small: true, columns: partnerCols(x.customers), rows: partnerRows(x.customers), totals: partnerTotals(x.customers), empty: 'لا توجد حركة على العملاء' },
      { t: 'p', muted: true, text: 'الأعمار بطريقة «الأقدم يُسدد أولًا»، والرصيد الافتتاحي يُعامل بتاريخ أول السنة. الفرق بين مجموع العملاء وبند القوائم يكون عادة من مخصص الديون المشكوك فيها أو حسابات مدينة بلا عميل محدد.' },
    ] },
    { title: 'ملحق: تحليل الموردين', lead: `أرصدة الموردين وحركتهم من بداية السنة وأعمار الأرصدة كما في ${curLabel}`, blocks: [
      { t: 'cards', items: [
        { label: 'مجموع أرصدة الموردين', value: x.suppliers.totals.balance, type: 'money' },
        { label: 'بند الذمم الدائنة التجارية في القوائم', value: apGl, type: 'money' },
        { label: 'دفعات مقدمة للموردين (أرصدة مدينة)', value: x.suppliers.totals.advance, type: 'money' },
        { label: 'عدد الموردين', value: x.suppliers.rows.length, type: 'number' },
      ] },
      { t: 'table', small: true, columns: partnerCols(x.suppliers), rows: partnerRows(x.suppliers), totals: partnerTotals(x.suppliers), empty: 'لا توجد حركة على الموردين' },
    ] },
    ...(x.appropriation && p.endsYear ? [appropriationSection(x.appropriation, p.year)] : []),
    { title: 'ملحق: الدليل المحاسبي وفق بنود القوائم', lead: 'ربط كل حساب فرعي ببند في القوائم المالية ومصدر الربط', blocks: [
      { t: 'table', small: true, columns: [{ key: 'code', label: 'رقم الحساب', width: '14%' }, { key: 'name', label: 'الحساب' }, { key: 'lineName', label: 'البند في القوائم' }, { key: 'source', label: 'مصدر الربط', width: '14%' }],
        rows: x.mapping.filter((m) => m.kind === 'sub' && m.isActive).map((m) => ({ code: m.code, name: m.name, lineName: `${FS_LINE.get(m.line)?.statement === 'bs' ? 'المركز المالي' : 'الدخل'}: ${m.lineName}`, source: `${SOURCE_AR[m.source]}${m.via ? ` (${m.via})` : ''}`, _tone: m.source === 'fallback' ? 'warn' as const : undefined })) },
    ] },
    { title: 'إقرار الإدارة والاعتماد', lead: 'مسؤولية الإدارة عن القوائم المالية واعتمادها', blocks: [
      { t: 'p', text: 'تقر إدارة الشركة بمسؤوليتها عن إعداد هذه القوائم المالية وعرضها بعدل وفق إطار التقرير المالي المعتمد، وعن الرقابة الداخلية التي تراها لازمة لإعداد قوائم خالية من التحريف الجوهري، وتؤكد أن جميع القيود المحاسبية للفترة رُحّلت وأُغلقت الفترة في النظام قبل إصدار هذا الملف.' },
      { t: 'signatures', rows: signatureRows(x), note: x.board ? `أسماء المجلس من تشكيل «${x.board.name}» في نظام الاجتماعات.` : 'لم يُسجل تشكيل المجلس في نظام الاجتماعات بعد، فتُكتب الأسماء يدويًا.' },
      { t: 'h', text: 'استلام المراجع الخارجي' },
      { t: 'kv', items: [{ label: 'اسم مكتب المراجعة', value: '................................' }, { label: 'تاريخ الاستلام', value: '..... / ..... / ..........' }, { label: 'الاسم والتوقيع', value: '................................' }, { label: 'ملاحظات', value: '................................' }] },
    ] },
  ];

  const docNo = `${FS_FORM.code}/${p.year}-${p.key}${x.issueNo ? `/${x.issueNo}` : ''}`;
  return {
    formCode: FS_FORM.code, docNo, kindLabel: x.issueNo ? `إصدار نهائي رقم ${x.issueNo}` : 'معاينة قبل الإصدار', title: p.endsYear && p.span === 'Y' ? 'القوائم المالية السنوية والإيضاحات المتممة' : 'القوائم المالية الأولية والإيضاحات المتممة',
    subject: p.label, period: p.range, audience: 'المراجع الخارجي ومجلس المديرين', ...x.brand,
    control: [
      { label: 'رمز النموذج', value: FS_FORM.code }, { label: 'رقم الوثيقة', value: docNo }, { label: 'الفترة', value: p.label }, { label: 'من', value: p.from, type: 'date' }, { label: 'إلى', value: p.to, type: 'date' },
      { label: 'حالة الفترة', value: x.closed ? 'مغلقة وقيودها مرحّلة' : 'غير مغلقة (معاينة فقط)' },
      { label: 'المقارنة', value: st.comparative ? `السنة المالية ${st.comparative.year}${st.comparative.closed ? '' : ' (غير مغلقة)'}` : 'لا توجد' },
      { label: 'أُعد بواسطة', value: x.actorName }, { label: 'تاريخ الإصدار', value: nowStamp() },
    ],
    sections, generatedBy: x.actorName, generatedAt: nowStamp(), classification: 'سري، للمراجع الخارجي ومجلس المديرين', issuer: 'صادر من النظام المالي',
    watermark: x.closed ? null : 'مسودة ــ الفترة غير مغلقة',
  };
}

function checkBlocks(st: Computed): Block[] {
  if (!st.warnings.length) return [];
  return [{ t: 'callout', tone: st.bs.difference.cur ? 'bad' : 'warn', title: 'تنبيهات قبل الاعتماد', text: st.warnings.join('. ') }];
}

function sumBy<T extends Record<string, unknown>>(rows: T[], k: keyof T) { return Math.round(rows.reduce((t, r) => t + Number(r[k] ?? 0) * 100, 0)) / 100; }
function sumLine(st: Computed, code: string) { return st.bs.groups.flatMap((g) => g.rows).filter((r) => r.code === code).reduce((t, r) => t + r.cur, 0); }
const fmtMoney = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));

const DEP_KEYS = ['costOpening', 'additions', 'disposals', 'costClosing', 'accumOpening', 'depreciation', 'accumDisposed', 'accumClosing', 'nbv'] as const;
function pick(o: Record<string, unknown>) { return Object.fromEntries(DEP_KEYS.map((k) => [k, o[k]])); }
function depCols(withDate: boolean): DocColumn[] {
  return [
    { key: 'name', label: withDate ? 'المجموعة / الأصل' : 'المجموعة' }, ...(withDate ? [{ key: 'date', label: 'تاريخ الشراء', type: 'date' as const }] : []),
    money('costOpening', 'التكلفة أول السنة'), money('additions', 'الإضافات'), money('disposals', 'الاستبعادات'), money('costClosing', 'التكلفة آخر الفترة'),
    money('accumOpening', 'المجمع أول السنة'), money('depreciation', 'إهلاك الفترة'), money('accumDisposed', 'مجمع المستبعد'), money('accumClosing', 'المجمع آخر الفترة'), money('nbv', 'صافي القيمة'),
  ];
}

function appropriationSection(a: NonNullable<Approp>, year: number): DocSection {
  const r = a.result;
  return {
    title: 'ملحق: مشروع توزيع الأرباح', lead: `مقترح تخصيص أرباح السنة المالية ${year} وفق المادة (10) من النظام الأساس وسياسة POL-FIN-03`,
    blocks: [
      { t: 'callout', tone: 'info', title: 'مشروع خاضع لاعتماد المجلس', text: 'هذا مقترح يُرفع مع القوائم المالية السنوية ولا يُنفذ إلا بقرار من مجلس المديرين. نسب السياسة POL-FIN-03 ما زالت مقترحة للمجلس، وحدود النظام الأساس ملزمة: 30% حدًا أعلى للتنمية والتوسع، و10% حدًا أعلى للتوزيع.' },
      { t: 'table', columns: [{ key: 'name', label: 'البيان' }, money('amount', 'المبلغ'), { key: 'pct', label: 'النسبة', type: 'percent' }], rows: [
        { name: 'صافي ربح السنة', amount: r.netProfit },
        { name: 'يُطرح: الخسائر المتراكمة', amount: -r.accumulatedLosses },
        { name: 'يُطرح: أرباح غير محققة نقدًا', amount: -r.unrealized },
        { name: 'الأرباح القابلة للتخصيص', amount: r.distributable, pct: 100, _style: 'strong' },
        { name: 'تنمية الاستثمارات والتوسع (حتى 30%)', amount: r.development, pct: r.developmentPct, _style: 'group' },
        { name: `منها: الاحتياطي التشغيلي (المستهدف مصروفات ${a.inputs.reserveMonths} أشهر = ${fmtMoney(r.reserveTarget)}، والرصيد الحالي ${fmtMoney(r.reserveBalance)})`, amount: r.reserve, _level: 1 },
        { name: 'منها: التوسع في الأعمال', amount: r.expansion, _level: 1 },
        { name: 'الإنفاق في المصارف غير الربحية', amount: r.nonprofit, pct: r.nonprofitPct, _style: 'group' },
        { name: 'منها: برامج مقترحة', amount: r.programsTotal, _level: 1 },
        { name: 'منها: مرصود في حساب مخصص لسنة لاحقة', amount: r.deferred, _level: 1 },
        { name: 'التوزيع (حتى 10%)', amount: r.distribution, pct: r.distributionPct, _style: 'group' },
      ], indent: 'name' },
      { t: 'h', text: 'البرامج المقترح تمويلها في المصارف غير الربحية' },
      { t: 'table', small: true, empty: 'لم تُحدد برامج بعد', columns: [{ key: 'channel', label: 'المصرف (المادة 4)' }, { key: 'name', label: 'البرنامج' }, money('amount', 'المبلغ')],
        rows: a.inputs.programs.map((x) => ({ channel: `${x.channel}. ${NONPROFIT_CHANNELS[x.channel - 1] ?? ''}`, name: x.name, amount: x.amount })) },
      { t: 'h', text: 'القيود المقترحة بعد اعتماد المجلس' },
      { t: 'table', small: true, empty: 'لا توجد قيود', columns: [{ key: 'debit', label: 'من حـ/' }, { key: 'credit', label: 'إلى حـ/' }, money('amount', 'المبلغ')], rows: r.entries },
      { t: 'list', tone: 'warn', items: r.issues.map((i) => i.text) },
      ...(a.inputs.notes ? [{ t: 'p' as const, text: `ملاحظات: ${a.inputs.notes}` }] : []),
    ],
  };
}

function signatureRows(x: FsDocInput) {
  const members = (x.board?.members ?? []).filter((m) => BOARD_ROLE_ORDER.includes(m.role)).sort((a, b) => BOARD_ROLE_ORDER.indexOf(a.role) - BOARD_ROLE_ORDER.indexOf(b.role));
  return [
    { role: 'إعداد: المحاسب', name: x.actorName },
    { role: 'مراجعة: المسؤول المالي', name: null },
    { role: 'المدير التنفيذي', name: null },
    ...(members.length ? members.map((m) => ({ role: BOARD_ROLE[m.role] ?? m.role, name: m.name, title: m.title })) : [{ role: 'رئيس المجلس', name: null }, { role: 'عضو المجلس', name: null }]),
  ];
}
