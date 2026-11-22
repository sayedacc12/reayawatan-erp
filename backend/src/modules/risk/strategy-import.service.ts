import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import {
  findSheet, lines, loadXlsx, parseDate, parseNum, readKeyValues, readSheet, SheetCol, writeHelp, writeKeyValues, writeSheet,
} from '../../core/files/xlsx-sheets';
import { RiskAnalysis, RiskItem } from './entities/risk.entity';
import { PESTEL_FACTORS, SWOT_FACTORS } from './risk-defaults';
import { AnalysisDto, RiskDto } from './risk.dto';
import { RegisterService } from './register.service';
import { RiskCore } from './risk-core.service';

const S_INFO = 'البيانات العامة', S_PESTEL = 'PESTEL', S_SWOT = 'SWOT', S_TOWS = 'TOWS', S_RISKS = 'المخاطر';
const MAX_FACTORS = 120, MAX_STRATEGIES = 40, MAX_RISKS = 300;

const FACTOR_COLS: SheetCol[] = [
  { key: 'key', label: 'الرمز', required: true, width: 10, note: 'رمز قصير فريد في الملف كله (مثل PL1 أو W2)، تستخدمه ورقة المخاطر للربط' },
  { key: 'factor', label: 'العامل', required: true, width: 18 },
  { key: 'text', label: 'النص', required: true, width: 70 },
  { key: 'impact', label: 'الأثر', required: true, width: 9, note: 'من 1 إلى 5', list: ['1', '2', '3', '4', '5'] },
  { key: 'likelihood', label: 'الاحتمالية', required: true, width: 11, note: 'من 1 إلى 5', list: ['1', '2', '3', '4', '5'] },
  { key: 'trend', label: 'الاتجاه', width: 12, list: ['متصاعد', 'مستقر', 'متراجع'] },
  { key: 'note', label: 'ملاحظة', width: 40 },
];
const TOWS_COLS: SheetCol[] = [
  { key: 'type', label: 'النوع', required: true, width: 10, list: ['SO', 'WO', 'ST', 'WT'] },
  { key: 'text', label: 'الاستراتيجية', required: true, width: 100 },
];
const RISK_COLS: SheetCol[] = [
  { key: 'key', label: 'الرمز', required: true, width: 8, note: 'رمز الخطر في الملف (مثل R01). النظام يعطيه رمزه الخاص عند الحفظ' },
  { key: 'title', label: 'عنوان الخطر', required: true, width: 40 },
  { key: 'description', label: 'الوصف', width: 40 },
  { key: 'source', label: 'المصدر', required: true, width: 10, list: ['داخلي', 'خارجي', 'منتج'] },
  { key: 'category', label: 'التصنيف', required: true, width: 16, note: 'اسم التصنيف أو رمزه كما في إعدادات المخاطر' },
  { key: 'product', label: 'المنتج أو الخدمة', width: 18, note: 'إلزامي إذا كان المصدر «منتج»' },
  { key: 'owner', label: 'المسؤول', width: 18 },
  { key: 'causes', label: 'الأسباب', width: 35 },
  { key: 'consequences', label: 'الآثار', width: 35 },
  { key: 'il', label: 'الاحتمالية الكامنة', required: true, width: 10, list: ['1', '2', '3', '4', '5'] },
  { key: 'ii', label: 'الأثر الكامن', required: true, width: 10, list: ['1', '2', '3', '4', '5'] },
  { key: 'rl', label: 'الاحتمالية المتبقية', required: true, width: 10, list: ['1', '2', '3', '4', '5'] },
  { key: 'ri', label: 'الأثر المتبقي', required: true, width: 10, list: ['1', '2', '3', '4', '5'] },
  { key: 'target', label: 'الدرجة المستهدفة', width: 10, note: 'من 1 إلى 25، ولا تزيد على الدرجة المتبقية' },
  { key: 'treatment', label: 'المعالجة', required: true, width: 10, list: ['تجنب', 'تخفيف', 'نقل', 'قبول'] },
  { key: 'treatmentNote', label: 'مبرر المعالجة', width: 30, note: 'إلزامي عند قبول خطر فوق حد الرغبة في المخاطر' },
  { key: 'actions', label: 'إجراءات المعالجة', width: 50, note: 'إجراء في كل سطر: العنوان | المسؤول | تاريخ الاستحقاق' },
  { key: 'kris', label: 'مؤشرات الإنذار المبكر', width: 35, note: 'مؤشر في كل سطر: الاسم | الحد' },
  { key: 'factorKey', label: 'رمز العامل في التحليل', width: 12, note: 'رمز عامل من ورقة PESTEL أو SWOT (ليس نقطة قوة أو فرصة)' },
  { key: 'objectives', label: 'الأهداف المرتبطة', width: 14, note: 'للمعلومية فقط: الربط بالأهداف يتم من استيراد الخطة (ورقة الروابط)' },
];

const PESTEL_BY_LABEL: Record<string, string> = Object.fromEntries([
  ...PESTEL_FACTORS.flatMap((f) => [[f.name, f.code], [f.code, f.code]]), ['سياسي', 'political'], ['اقتصادي', 'economic'], ['اجتماعي', 'social'],
  ['تقني', 'technological'], ['بيئي', 'environmental'], ['قانونية', 'legal'], ['قانوني', 'legal'], ['تنظيمية', 'legal'],
]);
const SWOT_BY_LABEL: Record<string, string> = Object.fromEntries([
  ...SWOT_FACTORS.flatMap((f) => [[f.name, f.code], [f.code, f.code]]), ['قوة', 'strength'], ['ضعف', 'weakness'], ['فرصة', 'opportunity'], ['تهديد', 'threat'],
]);
const TREND: Record<string, 'up' | 'stable' | 'down'> = { متصاعد: 'up', مستقر: 'stable', متراجع: 'down', up: 'up', stable: 'stable', down: 'down' };
const SOURCE: Record<string, RiskDto['source']> = { داخلي: 'internal', خارجي: 'external', منتج: 'product', 'منتج أو خدمة': 'product', internal: 'internal', external: 'external', product: 'product' };
const TREATMENT: Record<string, RiskDto['treatment']> = { تجنب: 'avoid', تخفيف: 'reduce', نقل: 'transfer', قبول: 'accept', avoid: 'avoid', reduce: 'reduce', transfer: 'transfer', accept: 'accept' };
const KEY_RE = /^[A-Za-z0-9._-]{1,20}$/;

export interface ImportIssue { sheet: string; row: number | null; label: string | null; messages: string[] }
export interface StrategyImportResult {
  mode: 'check' | 'apply';
  ok: boolean;
  analyses: { kind: 'pestel' | 'swot'; title: string; items: number; strategies: number; status: 'new' | 'exists'; id: string | null; code: string | null }[];
  risks: { row: number; key: string; title: string; inherent: number; residual: number; factorKey: string | null; status: 'new' | 'exists'; id: string | null; code: string | null }[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  created: { analyses: number; risks: number };
}

interface ParsedAnalysis { kind: 'pestel' | 'swot'; dto: AnalysisDto; keys: string[] }
interface ParsedRisk { row: number; key: string; dto: RiskDto; factorKey: string | null }

async function dtoErrors(cls: new () => object, plain: object): Promise<string[]> {
  const errs = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  const out: string[] = [];
  const walk = (es: typeof errs) => es.forEach((e) => { out.push(...Object.values(e.constraints ?? {})); if (e.children?.length) walk(e.children); });
  walk(errs);
  return [...new Set(out)];
}

/**
 * استيراد تحليلي PESTEL وSWOT واستراتيجيات TOWS ومخاطرهما المقترحة من ملف Excel واحد.
 * «check» يفحص كل شيء ويعرض التقرير دون حفظ، و«apply» يحفظ الكل في معاملة واحدة أو لا شيء.
 * التحليلات والمخاطر تُنشأ مسودات، وتمر بمسار الاعتماد المعتاد في النظام. التحليل أو الخطر الموجود بالعنوان نفسه لا يتكرر.
 */
@Injectable()
export class StrategyImportService {
  constructor(private readonly db: DataSource, private readonly core: RiskCore, private readonly register: RegisterService) {}

  async template() {
    const wb = new ExcelJS.Workbook();
    writeHelp(wb, [
      'استيراد تحليلات PESTEL وSWOT وسجل المخاطر',
      '1. املأ «البيانات العامة» بعنوان كل تحليل وتاريخه وملخصه. اترك عنوان التحليل فارغًا إن لم ترد استيراده.',
      '2. ورقتا PESTEL وSWOT: عامل في كل صف برمز فريد في الملف كله. الأثر والاحتمالية من 1 إلى 5.',
      `   عوامل PESTEL: ${PESTEL_FACTORS.map((f) => f.name).join('، ')}. عوامل SWOT: قوة، ضعف، فرصة، تهديد.`,
      '3. ورقة TOWS: الاستراتيجيات المستخلصة من SWOT بأنواعها SO وWO وST وWT.',
      '4. ورقة المخاطر: خطر في كل صف. الخطر المتبقي لا يزيد على الكامن، وقبول خطر فوق حد الرغبة يلزمه مبرر.',
      '   إجراءات المعالجة: إجراء في كل سطر بالصيغة «العنوان | المسؤول | 2027-06-30». مؤشرات الإنذار: «الاسم | الحد».',
      '   «رمز العامل في التحليل» يربط الخطر بعامل التهديد أو الضعف الذي نشأ منه.',
      '5. ارفع الملف من شاشة تحليلات PESTEL وSWOT: يُفحص أولًا ويظهر تقرير بالأخطاء، ولا يُحفظ شيء حتى توافق. الحفظ كله أو لا شيء.',
      '6. تُنشأ التحليلات والمخاطر مسودات، ثم ترفعها للاعتماد من شاشاتها. التحليل أو الخطر الموجود بالعنوان نفسه لا يُكرر.',
      '7. اربط الأهداف بالمخاطر والعوامل بعد اعتماد التحليلات، من استيراد الخطة (ورقة الروابط) أو من شاشة الخطة.',
    ]);
    writeKeyValues(wb, S_INFO, [
      ['عنوان تحليل PESTEL', 'تحليل PESTEL للخطة الاستراتيجية'], ['ملخص PESTEL', ''],
      ['عنوان تحليل SWOT', 'تحليل SWOT للخطة الاستراتيجية'], ['ملخص SWOT', ''],
      ['النطاق', 'الشركة كاملة'], ['تاريخ التحليل', new Date().toISOString().slice(0, 10), 'بصيغة 2027-01-31'],
    ]);
    writeSheet(wb, S_PESTEL, FACTOR_COLS.map((c) => (c.key === 'factor' ? { ...c, list: PESTEL_FACTORS.map((f) => f.name) } : c)), [
      ['PL1', 'سياسية', 'مثال: توجهات رؤية المملكة 2030 للقطاع غير الربحي', 5, 4, 'متصاعد', ''],
    ]);
    writeSheet(wb, S_SWOT, FACTOR_COLS.map((c) => (c.key === 'factor' ? { ...c, list: ['قوة', 'ضعف', 'فرصة', 'تهديد'] } : c)), [
      ['W1', 'ضعف', 'مثال: محدودية رأس المال', 4, 4, 'مستقر', ''],
    ]);
    writeSheet(wb, S_TOWS, TOWS_COLS, [['WO', 'مثال: معالجة الضعف باستثمار الفرصة']]);
    writeSheet(wb, S_RISKS, RISK_COLS, [
      ['R01', 'مثال: نقص السيولة', '', 'داخلي', 'مالية', '', 'المدير المالي', '', '', 4, 4, 3, 3, 6, 'تخفيف', '', 'دفعة مقدمة في العقود | المدير المالي | 2027-03-31', 'النقد المتاح بالأشهر | أقل من شهرين', 'W1', ''],
    ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async import(actor: OrgUser, file: Express.Multer.File | undefined, mode: string): Promise<StrategyImportResult> {
    if (mode !== 'check' && mode !== 'apply') throw new BadRequestException('وضع الاستيراد غير صحيح');
    const wb = await loadXlsx(file);
    const org = actor.organizationId;
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const err = (sheet: string, row: number | null, label: string | null, messages: string[]) => { if (messages.length) errors.push({ sheet, row, label, messages }); };

    // ---------------- البيانات العامة
    const infoWs = findSheet(wb, S_INFO);
    const info = infoWs ? readKeyValues(infoWs) : new Map<string, string>();
    const dateRaw = info.get('تاريخ التحليل') ?? '';
    const analysisDate = parseDate(dateRaw) ?? new Date().toISOString().slice(0, 10);
    if (parseDate(dateRaw) === undefined) err(S_INFO, null, 'تاريخ التحليل', ['تاريخ التحليل غير صحيح. اكتبه بصيغة 2027-01-31']);
    const scope = info.get('النطاق') || null;

    // ---------------- العوامل
    const allKeys = new Map<string, { kind: 'pestel' | 'swot'; id: string; factor: string }>();
    const parseFactors = (sheet: string, kind: 'pestel' | 'swot', map: Record<string, string>) => {
      const ws = findSheet(wb, sheet);
      if (!ws) return [];
      const rows = readSheet(ws, FACTOR_COLS, MAX_FACTORS, sheet);
      const items: (AnalysisDto['items'][number] & { key: string })[] = [];
      for (const { row, v } of rows) {
        const m: string[] = [];
        if (!KEY_RE.test(v.key)) m.push('الرمز إلزامي: حروف إنجليزية وأرقام بلا مسافات (حتى 20)');
        else if (allKeys.has(v.key)) m.push(`الرمز ${v.key} مكرر في الملف`);
        const factor = map[v.factor];
        if (!factor) m.push(`العامل «${v.factor}» غير معروف في تحليل ${kind === 'pestel' ? 'PESTEL' : 'SWOT'}`);
        const impact = parseNum(v.impact), likelihood = parseNum(v.likelihood);
        if (v.trend && !TREND[v.trend]) m.push('الاتجاه: متصاعد أو مستقر أو متراجع');
        err(sheet, row, v.key || v.text.slice(0, 40), m);
        if (m.length) continue;
        const id = randomUUID();
        allKeys.set(v.key, { kind, id, factor });
        items.push({ key: v.key, id, factor, text: v.text, impact: impact as number, likelihood: likelihood as number, trend: v.trend ? TREND[v.trend] : null, note: v.note || null });
      }
      return items;
    };
    const pestelItems = parseFactors(S_PESTEL, 'pestel', PESTEL_BY_LABEL);
    const swotItems = parseFactors(S_SWOT, 'swot', SWOT_BY_LABEL);
    const towsWs = findSheet(wb, S_TOWS);
    const strategies = towsWs ? readSheet(towsWs, TOWS_COLS, MAX_STRATEGIES, S_TOWS).map(({ row, v }) => {
      const t = v.type.toUpperCase();
      if (!['SO', 'WO', 'ST', 'WT'].includes(t)) { err(S_TOWS, row, v.type, ['النوع: SO أو WO أو ST أو WT']); return null; }
      return { type: t as 'SO' | 'WO' | 'ST' | 'WT', text: v.text };
    }).filter((x): x is NonNullable<typeof x> => !!x) : [];

    const analyses: ParsedAnalysis[] = [];
    for (const [kind, items, titleKey, summaryKey, sheet] of [
      ['pestel', pestelItems, 'عنوان تحليل PESTEL', 'ملخص PESTEL', S_PESTEL], ['swot', swotItems, 'عنوان تحليل SWOT', 'ملخص SWOT', S_SWOT],
    ] as const) {
      const title = info.get(titleKey) ?? '';
      if (!items.length) { if (title) warnings.push({ sheet, row: null, label: title, messages: ['لا توجد عوامل في الورقة، فلن يُنشأ هذا التحليل'] }); continue; }
      if (!title) { err(S_INFO, null, titleKey, [`اكتب «${titleKey}» أو احذف عوامل ورقة ${sheet}`]); continue; }
      const dto = {
        kind, title, scope, analysisDate, summary: info.get(summaryKey) || null,
        items: items.map(({ key: _k, ...i }) => i), ...(kind === 'swot' && strategies.length ? { strategies } : {}),
      } as AnalysisDto;
      err(S_INFO, null, title, await dtoErrors(AnalysisDto, dto));
      analyses.push({ kind, dto, keys: items.map((i) => i.key) });
    }
    if (strategies.length && !swotItems.length) err(S_TOWS, null, null, ['استراتيجيات TOWS تحتاج تحليل SWOT في الملف نفسه']);

    // ---------------- المخاطر
    const cfg = await this.core.config(org);
    const catByLabel = new Map(cfg.categories.flatMap((c) => [[c.name, c.code], [c.code, c.code]] as [string, string][]));
    const risks: ParsedRisk[] = [];
    const riskWs = findSheet(wb, S_RISKS);
    const seenTitles = new Set<string>();
    for (const { row, v } of riskWs ? readSheet(riskWs, RISK_COLS, MAX_RISKS, S_RISKS) : []) {
      const m: string[] = [];
      const source = SOURCE[v.source];
      if (!source) m.push('المصدر: داخلي أو خارجي أو منتج');
      const category = catByLabel.get(v.category);
      if (!category) m.push(`التصنيف «${v.category}» غير معرّف في إعدادات المخاطر`);
      const treatment = TREATMENT[v.treatment];
      if (!treatment) m.push('المعالجة: تجنب أو تخفيف أو نقل أو قبول');
      if (seenTitles.has(v.title)) m.push('عنوان الخطر مكرر في الملف');
      seenTitles.add(v.title);
      const actions = lines(v.actions).map((l) => {
        const [title, owner, due] = l.split('|').map((x) => x.trim());
        const d = parseDate(due ?? '');
        if (d === undefined) m.push(`تاريخ الإجراء «${due}» غير صحيح`);
        return { title: title ?? '', ownerName: owner || null, dueDate: d ?? null, status: 'planned' as const, note: null };
      });
      const kris = lines(v.kris).map((l) => {
        const [name, threshold] = l.split('|').map((x) => x.trim());
        return { name: name ?? '', threshold: threshold || '—', current: null, breached: false };
      });
      let factorKey: string | null = v.factorKey || null;
      if (factorKey) {
        const f = allKeys.get(factorKey);
        if (!f) m.push(`رمز العامل ${factorKey} غير موجود في ورقتي PESTEL وSWOT`);
        else if (['strength', 'opportunity'].includes(f.factor)) m.push('نقاط القوة والفرص لا تُربط بالمخاطر');
        if (!f) factorKey = null;
      }
      const num = (s: string) => { const n = parseNum(s); return n === null || Number.isNaN(n) ? (s ? s : undefined) : n; };
      const dto = {
        title: v.title, description: v.description || null, source, category: category ?? v.category, productName: v.product || null, ownerName: v.owner || null,
        causes: v.causes || null, consequences: v.consequences || null,
        inherentLikelihood: num(v.il), inherentImpact: num(v.ii), residualLikelihood: num(v.rl), residualImpact: num(v.ri),
        targetScore: v.target ? num(v.target) : null, treatment, treatmentNote: v.treatmentNote || null, actions, kris, identifiedDate: analysisDate,
      } as unknown as RiskDto;
      if (!m.length) {
        m.push(...(await dtoErrors(RiskDto, dto)));
        if (!m.length) { const why = await this.register.checkRisk(org, dto); if (why) m.push(why); }
      }
      err(S_RISKS, row, v.key || v.title.slice(0, 40), m);
      if (!m.length) risks.push({ row, key: v.key, dto, factorKey });
    }
    if (!analyses.length && !risks.length && !errors.length) throw new BadRequestException('لا توجد بيانات للاستيراد في الملف. استخدم النموذج المنزَّل من النظام');

    // ---------------- الموجود مسبقًا
    const run = async (em = this.db.manager) => {
      const existingA = analyses.length ? await em.getRepository(RiskAnalysis).find({ where: { organizationId: org, title: In(analyses.map((a) => a.dto.title)) }, select: ['id', 'code', 'title', 'kind'] }) : [];
      const existingR = risks.length ? await em.getRepository(RiskItem).find({ where: { organizationId: org, title: In(risks.map((r) => r.dto.title)) }, select: ['id', 'code', 'title'] }) : [];
      const out: StrategyImportResult = { mode: mode as 'check' | 'apply', ok: !errors.length, analyses: [], risks: [], errors, warnings, created: { analyses: 0, risks: 0 } };
      const skippedKinds = new Set<string>();
      for (const a of analyses) {
        const ex = existingA.find((x) => x.title === a.dto.title && x.kind === a.kind);
        if (ex) { skippedKinds.add(a.kind); warnings.push({ sheet: a.kind === 'pestel' ? S_PESTEL : S_SWOT, row: null, label: a.dto.title, messages: [`يوجد تحليل بالعنوان نفسه (${ex.code})، فلن يُنشأ مرة أخرى ولن تُربط به المخاطر`] }); }
        out.analyses.push({ kind: a.kind, title: a.dto.title, items: a.dto.items.length, strategies: a.dto.strategies?.length ?? 0, status: ex ? 'exists' : 'new', id: ex?.id ?? null, code: ex?.code ?? null });
      }
      for (const r of risks) {
        const ex = existingR.find((x) => x.title === r.dto.title);
        if (ex) warnings.push({ sheet: S_RISKS, row: r.row, label: r.key, messages: [`يوجد خطر بالعنوان نفسه (${ex.code})، فلن يُكرر`] });
        const fk = r.factorKey && !skippedKinds.has(allKeys.get(r.factorKey)!.kind) ? r.factorKey : null;
        out.risks.push({
          row: r.row, key: r.key, title: r.dto.title, inherent: r.dto.inherentLikelihood * r.dto.inherentImpact, residual: r.dto.residualLikelihood * r.dto.residualImpact,
          factorKey: fk, status: ex ? 'exists' : 'new', id: ex?.id ?? null, code: ex?.code ?? null,
        });
      }
      return out;
    };
    if (mode === 'check' || errors.length) return run();

    return this.db.transaction(async (em) => {
      const out = await run(em);
      const ids = new Map<string, string>(); // kind -> analysis id
      for (const a of analyses) {
        const row = out.analyses.find((x) => x.kind === a.kind)!;
        if (row.status === 'exists') continue;
        const saved = await this.register.saveImportedAnalysis(em, actor, a.dto);
        ids.set(a.kind, saved.id);
        Object.assign(row, { id: saved.id, code: saved.code });
        out.created.analyses++;
      }
      for (const r of risks) {
        const row = out.risks.find((x) => x.row === r.row)!;
        if (row.status === 'exists') continue;
        const f = row.factorKey ? allKeys.get(row.factorKey)! : null;
        const analysisId = f ? ids.get(f.kind) ?? null : null;
        const saved = await this.register.saveImportedRisk(em, actor, { ...r.dto, analysisId, analysisItemId: analysisId ? f!.id : null } as RiskDto);
        Object.assign(row, { id: saved.id, code: saved.code });
        out.created.risks++;
      }
      return out;
    });
  }
}
