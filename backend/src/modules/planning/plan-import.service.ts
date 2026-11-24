import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import {
  findSheet, lines, loadXlsx, parseDate, parseNum, readKeyValues, readSheet, SheetCol, writeHelp, writeKeyValues, writeSheet,
} from '../../core/files/xlsx-sheets';
import { Plan, PlanItem } from './entities/planning.entity';
import { ItemDto, KpiDto, PlanDto } from './planning.dto';
import { PlanningLinks, RefOption } from './planning-links.service';
import { PlanImportData, PlansService } from './plans.service';

const S_PLAN = 'الخطة', S_ITEMS = 'العناصر', S_KPIS = 'المؤشرات', S_LINKS = 'الروابط';
const MAX_ITEMS = 500, MAX_KPIS = 300, MAX_LINKS = 500;
const KEY_RE = /^[A-Za-z0-9._-]{1,30}$/;

const ITEM_COLS: SheetCol[] = [
  { key: 'key', label: 'الرمز', required: true, width: 10, note: 'رمز العنصر في الملف (مثل D1 أو G1.2 أو I1.2.3). النظام يعطي رموزه بالترتيب نفسه' },
  { key: 'parent', label: 'الرمز الأب', width: 10, note: 'فارغ للمستوى الأعلى. الأب يسبق أبناءه في الورقة' },
  { key: 'title', label: 'العنوان', required: true, width: 45 },
  { key: 'description', label: 'الوصف', width: 50 },
  { key: 'owner', label: 'المسؤول', width: 20 },
  { key: 'start', label: 'تاريخ البداية', width: 13, note: 'بصيغة 2027-01-01' },
  { key: 'end', label: 'تاريخ النهاية', width: 13 },
  { key: 'weight', label: 'الوزن', width: 8, note: 'من 0 إلى 1000، الافتراضي 1' },
  { key: 'funding', label: 'نوع التمويل', width: 12, list: ['ذاتي', 'مقيد', 'مختلط'] },
];
const KPI_COLS: SheetCol[] = [
  { key: 'item', label: 'رمز العنصر', width: 10, note: 'رمز العنصر من ورقة العناصر، أو فارغ لمؤشر على مستوى الخطة' },
  { key: 'name', label: 'اسم المؤشر', required: true, width: 45 },
  { key: 'unit', label: 'الوحدة', required: true, width: 9 },
  { key: 'direction', label: 'الاتجاه', width: 10, list: ['تصاعدي', 'تنازلي'] },
  { key: 'frequency', label: 'دورية القياس', width: 12, list: ['سنوية', 'نصف سنوية', 'ربع سنوية', 'شهرية'] },
  { key: 'aggregation', label: 'طريقة التجميع', width: 12, list: ['آخر قراءة', 'مجموع', 'متوسط'] },
  { key: 'baseline', label: 'خط الأساس', width: 10 },
  { key: 'weight', label: 'الوزن', width: 8 },
  { key: 'owner', label: 'المسؤول', width: 18 },
  { key: 'source', label: 'مصدر البيانات', width: 30 },
  { key: 'description', label: 'الوصف', width: 30 },
];
const LINK_COLS: SheetCol[] = [
  { key: 'item', label: 'رمز العنصر', required: true, width: 10 },
  { key: 'system', label: 'النظام', required: true, width: 22, list: ['سجل المخاطر', 'تحليل PESTEL وSWOT', 'الخطة الأم'] },
  { key: 'ref', label: 'المرجع', required: true, width: 60, note: 'سجل المخاطر: رمز الخطر أو عنوانه. التحليل: نص العامل كما هو في تحليل معتمد. الخطة الأم: رمز العنصر فيها' },
  { key: 'contribution', label: 'نسبة المساهمة', width: 12, note: 'اختيارية، من 0.01 إلى 100' },
  { key: 'note', label: 'ملاحظة', width: 30 },
];

const KIND: Record<string, 'strategic' | 'operational'> = { استراتيجية: 'strategic', تشغيلية: 'operational', strategic: 'strategic', operational: 'operational' };
const PERIOD: Record<string, PlanDto['periodicity']> = { سنوية: 'annual', 'نصف سنوية': 'semiannual', 'ربع سنوية': 'quarterly', شهرية: 'monthly', annual: 'annual', semiannual: 'semiannual', quarterly: 'quarterly', monthly: 'monthly' };
const DIRECTION: Record<string, 'up' | 'down'> = { تصاعدي: 'up', تنازلي: 'down', up: 'up', down: 'down' };
const AGG: Record<string, 'last' | 'sum' | 'avg'> = { 'آخر قراءة': 'last', مجموع: 'sum', متوسط: 'avg', last: 'last', sum: 'sum', avg: 'avg' };
const FUNDING: Record<string, 'restricted' | 'unrestricted' | 'mixed'> = { ذاتي: 'unrestricted', 'غير مقيد': 'unrestricted', مقيد: 'restricted', مختلط: 'mixed' };
const SYSTEM: Record<string, 'risk' | 'risk_analysis' | 'parent'> = {
  'سجل المخاطر': 'risk', المخاطر: 'risk', 'تحليل PESTEL وSWOT': 'risk_analysis', 'تحليلات PESTEL وSWOT': 'risk_analysis', التحليل: 'risk_analysis', 'الخطة الأم': 'parent',
};

export interface PlanIssue { sheet: string; row: number | null; label: string | null; messages: string[] }
export interface PlanImportResult {
  mode: 'check' | 'apply';
  ok: boolean;
  plan: { kind: 'strategic' | 'operational'; title: string; startYear: number; endYear: number; parent: string | null; id: string | null; code: string | null } | null;
  items: { row: number; key: string; title: string; code: string | null }[];
  kpis: number;
  links: { row: number; item: string; system: string; ref: string; resolved: string | null }[];
  errors: PlanIssue[];
  warnings: PlanIssue[];
}

async function dtoErrors(cls: new () => object, plain: object, skip: string[] = []): Promise<string[]> {
  const errs = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true, skipMissingProperties: false });
  const out: string[] = [];
  const walk = (es: typeof errs) => es.forEach((e) => { if (!skip.includes(e.property)) out.push(...Object.values(e.constraints ?? {})); if (e.children?.length) walk(e.children); });
  walk(errs);
  return [...new Set(out)];
}

/**
 * استيراد خطة استراتيجية أو تشغيلية كاملة من Excel: الرأس والمستويات، والعناصر بتسلسلها، والمؤشرات بمستهدفاتها السنوية،
 * والروابط بسجل المخاطر وعوامل التحليلات المعتمدة وعناصر الخطة الأم. الفحص يجري الحفظ ثم يتراجع عنه، والحفظ كله أو لا شيء.
 * الخطة تُنشأ مسودة وتمر بمسار الاعتماد المعتاد.
 */
@Injectable()
export class PlanImportService {
  constructor(private readonly db: DataSource, private readonly plans: PlansService, private readonly links: PlanningLinks) {}

  async template() {
    const wb = new ExcelJS.Workbook();
    writeHelp(wb, [
      'استيراد خطة من Excel',
      '1. ورقة «الخطة»: نوع الخطة وعنوانها ومدتها ودورية متابعتها، والرؤية والرسالة والقيم (قيمة في كل سطر)، ومستويات الهيكل (مستوى في كل سطر: الاسم | الرمز بحروف إنجليزية كبيرة).',
      '   الخطة التشغيلية تتبع خطة استراتيجية: اكتب عنوانها أو رمزها في «الخطة الأم».',
      '2. ورقة «العناصر»: عنصر في كل صف برمز فريد، والأب يسبق أبناءه. المستوى يُعرف من تسلسل الآباء.',
      '   أعمدة التكلفة اختيارية بعنوان «تكلفة 2027» و«تكلفة 2028»... لسنوات الخطة. تكلفة السنة للأنشطة الدنيا في الخطط التشغيلية هي ما تستورده الموازنة.',
      '3. ورقة «المؤشرات»: مؤشر في كل صف مرتبط برمز العنصر، والمستهدفات في أعمدة «مستهدف 2027» و«مستهدف 2028»...',
      '4. ورقة «الروابط»: ربط العناصر بسجل المخاطر (رمز الخطر أو عنوانه)، أو بعامل من تحليل PESTEL أو SWOT معتمد (نص العامل)، أو بعنصر في الخطة الأم (رمزه).',
      '   الروابط التي لا يجدها النظام تظهر تنبيهًا ولا تمنع الاستيراد، ويمكن إضافتها لاحقًا من شاشة الخطة.',
      '5. ارفع الملف من شاشة الخطط: يُفحص أولًا ويظهر تقرير بالأخطاء والتنبيهات ولا يُحفظ شيء حتى توافق. الحفظ كله أو لا شيء.',
    ]);
    writeKeyValues(wb, S_PLAN, [
      ['نوع الخطة', 'استراتيجية', 'استراتيجية أو تشغيلية'], ['عنوان الخطة', 'الخطة الاستراتيجية'], ['سنة البداية', 2027], ['سنة النهاية', 2030],
      ['دورية المتابعة', 'سنوية', 'سنوية أو نصف سنوية أو ربع سنوية أو شهرية'], ['الرؤية', ''], ['الرسالة', ''], ['القيم', '', 'قيمة في كل سطر'],
      ['الوصف', ''], ['مالك الخطة', ''], ['الخطة الأم', '', 'للخطة التشغيلية فقط: عنوان الخطة الاستراتيجية أو رمزها'],
      ['المستويات', 'توجه استراتيجي | D\nهدف استراتيجي | G\nمبادرة | I', 'مستوى في كل سطر: الاسم | الرمز'],
    ]);
    const items = writeSheet(wb, S_ITEMS, ITEM_COLS, [['D1', '', 'مثال: توجه استراتيجي', '', '', '', '', '', ''], ['G1.1', 'D1', 'مثال: هدف', '', '', '', '', '', ''], ['I1.1.1', 'G1.1', 'مثال: مبادرة', '', '', '2027-01-01', '2027-12-31', '', 'ذاتي']]);
    ['تكلفة 2027', 'تكلفة 2028'].forEach((h, i) => { const c = items.getCell(1, ITEM_COLS.length + 1 + i); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }; });
    const kpis = writeSheet(wb, S_KPIS, KPI_COLS, [['G1.1', 'مثال: نسبة رضا العملاء', '%', 'تصاعدي', 'سنوية', 'آخر قراءة', '', '', '', '', '']]);
    ['مستهدف 2027', 'مستهدف 2028'].forEach((h, i) => { const c = kpis.getCell(1, KPI_COLS.length + 1 + i); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }; });
    writeSheet(wb, S_LINKS, LINK_COLS, [['G1.1', 'سجل المخاطر', 'RSK-001', '', '']]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** replaceId: يستبدل محتوى خطة قائمة بمحتوى الملف مع سبب التعديل revisionNote (لإدراج حزمة الشركة فقط، انظر PlansService.importPlan) */
  async import(actor: OrgUser, file: Express.Multer.File | undefined, mode: string, replaceId?: string, revisionNote?: string): Promise<PlanImportResult> {
    if (mode !== 'check' && mode !== 'apply') throw new BadRequestException('وضع الاستيراد غير صحيح');
    const wb = await loadXlsx(file);
    const org = actor.organizationId;
    const errors: PlanIssue[] = [];
    const warnings: PlanIssue[] = [];
    const err = (sheet: string, row: number | null, label: string | null, messages: string[]) => { if (messages.length) errors.push({ sheet, row, label, messages }); };
    const out: PlanImportResult = { mode: mode as 'check' | 'apply', ok: false, plan: null, items: [], kpis: 0, links: [], errors, warnings };

    // ---------------- الرأس
    const planWs = findSheet(wb, S_PLAN);
    if (!planWs) throw new BadRequestException(`الملف لا يحتوي ورقة «${S_PLAN}». نزّل النموذج من النظام`);
    const h = readKeyValues(planWs);
    const kind = KIND[h.get('نوع الخطة') ?? ''];
    if (!kind) err(S_PLAN, null, 'نوع الخطة', ['نوع الخطة: استراتيجية أو تشغيلية']);
    const levels = lines(h.get('المستويات') ?? '').map((l, i) => { const [name, prefix] = l.split('|').map((x) => x.trim()); return { key: `level${i + 1}`, name: name ?? '', prefix: (prefix ?? '').toUpperCase() }; });
    let parentPlanId: string | null = null;
    const parentRef = h.get('الخطة الأم') ?? '';
    if (parentRef) {
      const parent = await this.db.getRepository(Plan).findOne({ where: [{ organizationId: org, kind: 'strategic', code: parentRef }, { organizationId: org, kind: 'strategic', title: parentRef }], order: { createdAt: 'DESC' } });
      if (!parent) err(S_PLAN, null, 'الخطة الأم', [`لا توجد خطة استراتيجية بالعنوان أو الرمز «${parentRef}»`]);
      parentPlanId = parent?.id ?? null;
    }
    const header = {
      kind, title: h.get('عنوان الخطة') ?? '', startYear: parseNum(h.get('سنة البداية') ?? ''), endYear: parseNum(h.get('سنة النهاية') ?? ''),
      periodicity: PERIOD[h.get('دورية المتابعة') ?? ''] ?? (h.get('دورية المتابعة') ? h.get('دورية المتابعة') : 'annual'),
      vision: h.get('الرؤية') || null, mission: h.get('الرسالة') || null, values: lines(h.get('القيم') ?? ''), description: h.get('الوصف') || null,
      ownerName: h.get('مالك الخطة') || null, parentPlanId, ...(levels.length ? { levels } : {}),
    } as unknown as PlanDto;
    err(S_PLAN, null, header.title || null, await dtoErrors(PlanDto, header));
    // ---------------- العناصر
    const itemsWs = findSheet(wb, S_ITEMS);
    const items: PlanImportData['items'] = [];
    const keys = new Set<string>();
    for (const { row, v, extra } of itemsWs ? readSheet(itemsWs, ITEM_COLS, MAX_ITEMS, S_ITEMS) : []) {
      const m: string[] = [];
      if (!KEY_RE.test(v.key)) m.push('الرمز إلزامي: حروف إنجليزية وأرقام ونقاط بلا مسافات');
      else if (keys.has(v.key)) m.push(`الرمز ${v.key} مكرر`);
      if (v.parent && !keys.has(v.parent)) m.push(`الرمز الأب ${v.parent} غير موجود قبل هذا الصف`);
      const start = parseDate(v.start), end = parseDate(v.end);
      if (start === undefined) m.push('تاريخ البداية غير صحيح');
      if (end === undefined) m.push('تاريخ النهاية غير صحيح');
      const weight = parseNum(v.weight);
      if (weight !== null && Number.isNaN(weight)) m.push('الوزن رقم');
      if (v.funding && !FUNDING[v.funding]) m.push('نوع التمويل: ذاتي أو مقيد أو مختلط');
      const costByYear: Record<string, number> = {};
      for (const [label, val] of Object.entries(extra)) {
        const y = /^تكلفة\s*(\d{4})$/.exec(label)?.[1];
        if (!y || !val) continue;
        const n = parseNum(val);
        if (n === null || Number.isNaN(n) || n < 0) m.push(`«${label}» رقم موجب`);
        else if (n > 0) costByYear[y] = n;
      }
      const dto: Partial<ItemDto> = {
        title: v.title, description: v.description || null, ownerName: v.owner || null, startDate: start ?? null, endDate: end ?? null,
        ...(weight !== null && !Number.isNaN(weight) ? { weight } : {}), costByYear, fundingType: v.funding ? FUNDING[v.funding] ?? null : null,
      };
      if (!m.length) m.push(...(await dtoErrors(ItemDto, dto)));
      err(S_ITEMS, row, v.key || v.title.slice(0, 40), m);
      if (KEY_RE.test(v.key)) keys.add(v.key);
      if (!m.length) { items.push({ key: v.key, parentKey: v.parent || null, dto }); out.items.push({ row, key: v.key, title: v.title, code: null }); }
    }
    if (!items.length && !errors.some((e) => e.sheet === S_ITEMS)) err(S_ITEMS, null, null, ['لا توجد عناصر في ورقة العناصر']);

    // ---------------- المؤشرات
    const kpisWs = findSheet(wb, S_KPIS);
    const kpis: PlanImportData['kpis'] = [];
    for (const { row, v, extra } of kpisWs ? readSheet(kpisWs, KPI_COLS, MAX_KPIS, S_KPIS) : []) {
      const m: string[] = [];
      if (v.item && !keys.has(v.item)) m.push(`رمز العنصر ${v.item} غير موجود في ورقة العناصر`);
      const direction = DIRECTION[v.direction || 'تصاعدي'], frequency = PERIOD[v.frequency || 'سنوية'], aggregation = AGG[v.aggregation || 'آخر قراءة'];
      if (!direction) m.push('الاتجاه: تصاعدي أو تنازلي');
      if (!frequency) m.push('دورية القياس: سنوية أو نصف سنوية أو ربع سنوية أو شهرية');
      if (!aggregation) m.push('طريقة التجميع: آخر قراءة أو مجموع أو متوسط');
      const baseline = parseNum(v.baseline), weight = parseNum(v.weight);
      if (Number.isNaN(baseline)) m.push('خط الأساس رقم');
      if (Number.isNaN(weight)) m.push('الوزن رقم');
      const targets: Record<string, number> = {};
      for (const [label, val] of Object.entries(extra)) {
        const y = /^مستهدف\s*(\d{4}(?:-(?:H[12]|Q[1-4]|\d{2}))?)$/.exec(label)?.[1];
        if (!y || val === '') continue;
        const n = parseNum(val);
        if (n === null || Number.isNaN(n)) m.push(`«${label}» رقم`);
        else targets[y] = n;
      }
      if (!Object.keys(targets).length) m.push('حدد مستهدفًا واحدًا على الأقل في أعمدة «مستهدف 2027»...');
      const dto = {
        name: v.name, unit: v.unit, direction, frequency, aggregation, baseline: baseline ?? null, targets, ...(weight !== null && !Number.isNaN(weight) ? { weight } : {}),
        ownerName: v.owner || null, dataSource: v.source || null, description: v.description || null,
      } as KpiDto;
      if (!m.length) m.push(...(await dtoErrors(KpiDto, dto)));
      err(S_KPIS, row, v.name.slice(0, 40) || null, m);
      if (!m.length) kpis.push({ itemKey: v.item || null, dto });
    }
    out.kpis = kpis.length;

    // ---------------- الروابط
    const linksWs = findSheet(wb, S_LINKS);
    const refs: PlanImportData['refs'] = [];
    const parentLinks: PlanImportData['parentLinks'] = [];
    const options = new Map<string, RefOption[]>();
    const opts = async (s: 'risk' | 'risk_analysis') => { if (!options.has(s)) options.set(s, await this.links.options(actor, s)); return options.get(s)!; };
    const parentItems = parentPlanId ? await this.db.getRepository(PlanItem).find({ where: { organizationId: org, planId: parentPlanId }, select: ['id', 'code', 'title'] }) : [];
    for (const { row, v } of linksWs ? readSheet(linksWs, LINK_COLS, MAX_LINKS, S_LINKS) : []) {
      const m: string[] = [];
      const system = SYSTEM[v.system];
      if (!keys.has(v.item)) m.push(`رمز العنصر ${v.item} غير موجود في ورقة العناصر`);
      if (!system) m.push('النظام: سجل المخاطر أو تحليل PESTEL وSWOT أو الخطة الأم');
      const c = parseNum(v.contribution);
      if (Number.isNaN(c) || (c !== null && (c < 0.01 || c > 100))) m.push('نسبة المساهمة بين 0.01 و100');
      err(S_LINKS, row, v.item, m);
      if (m.length) continue;
      const note = v.note ? v.note.slice(0, 500) : null;
      let resolved: string | null = null;
      if (system === 'parent') {
        const to = parentItems.find((x) => x.code === v.ref);
        if (to) { parentLinks.push({ itemKey: v.item, toItemId: to.id, contribution: c, note }); resolved = `${to.code} ${to.title}`; }
      } else {
        const list = await opts(system);
        const o = system === 'risk' ? list.find((x) => x.code === v.ref) ?? list.find((x) => x.label === v.ref) : list.find((x) => String(x.meta.text ?? '') === v.ref);
        if (o) { refs.push({ itemKey: v.item, system, src: o, contribution: c, note }); resolved = `${o.code} ${o.label}`.slice(0, 200); }
      }
      if (!resolved) {
        warnings.push({ sheet: S_LINKS, row, label: v.item, messages: [system === 'risk_analysis'
          ? `لم يُعثر على العامل «${v.ref.slice(0, 60)}» في تحليل معتمد. اعتمد التحليل أولًا أو أضف الربط لاحقًا`
          : system === 'risk' ? `لم يُعثر على الخطر «${v.ref.slice(0, 60)}» في سجل المخاطر` : `لم يُعثر على العنصر ${v.ref} في الخطة الأم`] });
      }
      out.links.push({ row, item: v.item, system: v.system, ref: v.ref, resolved });
    }

    out.plan = kind ? { kind, title: header.title, startYear: header.startYear, endYear: header.endYear, parent: parentRef || null, id: null, code: null } : null;
    if (errors.length) return out;
    try {
      const res = await this.plans.importPlan(actor, { header, items, kpis, refs, parentLinks }, mode === 'check', replaceId, revisionNote);
      out.plan!.id = res.id;
      out.plan!.code = res.code;
      const codes = new Map(res.items.map((i) => [i.key, i.code]));
      out.items.forEach((i) => { i.code = codes.get(i.key) ?? null; });
      const differ = out.items.filter((i) => i.code && i.code !== i.key);
      if (differ.length) warnings.push({ sheet: S_ITEMS, row: null, label: null, messages: [`${differ.length} عنصرًا سيأخذ رمزًا مختلفًا عن رمز الملف (مثل ${differ[0].key} ← ${differ[0].code}). الروابط تُطبق على الرموز الجديدة`] });
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ConflictException) {
        err(S_PLAN, null, header.title, [String((e.getResponse() as { message?: string }).message ?? e.message)]);
        return out;
      }
      throw e;
    }
    out.ok = true;
    return out;
  }
}
