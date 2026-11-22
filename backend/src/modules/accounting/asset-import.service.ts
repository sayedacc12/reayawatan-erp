import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { assertSafeXlsx } from '../../core/files/xlsx-guard';
import { AccCore, cents, fromCents } from './acc-core.service';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { addDaysIso, AssetsService, bad } from './assets.service';
import { AssetGroup, AssetImport, AssetMove, FixedAsset } from './entities/assets.entity';

/** أعمدة نموذج الاستيراد الثابتة (والحقول المرنة لكل مجموعة تُضاف بعدها) */
const COLS = [
  { key: 'group', label: 'رمز المجموعة *', width: 16, note: 'اختر من القائمة (ورقة «المجموعات»)' },
  { key: 'name', label: 'اسم الأصل *', width: 32 },
  { key: 'description', label: 'الوصف', width: 28 },
  { key: 'serial', label: 'الرقم التسلسلي', width: 18 },
  { key: 'location', label: 'الموقع', width: 22 },
  { key: 'employee', label: 'رقم الموظف المستلم', width: 16, note: 'رقم الموظف من ورقة «الموظفون». إلزامي للأصول المادية' },
  { key: 'purchaseDate', label: 'تاريخ الشراء', width: 14, note: 'يوم/شهر/سنة أو سنة-شهر-يوم' },
  { key: 'cost', label: 'التكلفة عند الشراء', width: 16, note: 'اتركها فارغة لتسجيل الأصل بلا قيمة ثم شرائه من العمليات' },
  { key: 'accum', label: 'مجمع الإهلاك في تاريخ بدء النظام', width: 20 },
  { key: 'salvage', label: 'القيمة التخريدية', width: 14 },
  { key: 'insurance', label: 'يتطلب تأمين (نعم/لا)', width: 14 },
  { key: 'warranty', label: 'له ضمان (نعم/لا)', width: 14 },
  { key: 'warrantyProvider', label: 'جهة الضمان', width: 18 },
  { key: 'warrantyEnd', label: 'نهاية الضمان', width: 14 },
] as const;
type ColKey = (typeof COLS)[number]['key'];
const MAX_ROWS = 2000;
const YES = ['نعم', 'yes', 'y', '1', 'true', 'صح', '✓'];

/** نص الخلية مهما كان نوعها في Excel */
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

/** التاريخ بأي صيغة شائعة: 2024-03-15 أو 15/03/2024 */
function parseDate(s: string): string | null {
  if (!s) return null;
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}
function iso(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
const num = (s: string) => (s === '' ? null : Number(s.replace(/[,\s]/g, '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))));

/**
 * استيراد الأصول من Excel: نموذج يُنزَّل من النظام (بقوائم المجموعات والموظفين والحقول المرنة)، يُستكمل ثم يُرفع.
 * كل صف يُفحص بالكامل وتُجمع أخطاؤه؛ والنتيجة مكتملة أو جزئية (تُستورد الصفوف السليمة فقط) أو مرفوضة،
 * وفي وضع «الكل أو لا شيء» يُرفض الملف كاملًا إن وُجد أي خطأ.
 */
@Injectable()
export class AssetImportService {
  constructor(
    private readonly db: DataSource,
    private readonly core: AccCore,
    private readonly assets: AssetsService,
  ) {}

  private async context(org: string) {
    const groups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: org, isActive: true }, order: { sortOrder: 'ASC' } });
    const emps = (await this.assets.employees(org)).filter((e) => e.status === 'active');
    const years = await this.core.years(org);
    const first = years.find((y) => y.isFirst) ?? years[0];
    const cfg = await this.assets.config(org);
    // الحقول المرنة: عمود لكل حقل في كل مجموعة
    const fieldCols = groups.flatMap((g) => g.fields.map((f) => ({ groupId: g.id, groupCode: g.code, field: f, label: `${f.label} (${g.code})${f.required ? ' *' : ''}` })));
    return { groups, emps, first, cfg, fieldCols, openingDate: first ? addDaysIso(first.startDate, -1) : null };
  }

  /** نموذج Excel جاهز للتعبئة */
  async template(actor: OrgUser) {
    const ctx = await this.context(actor.organizationId);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sanabel ERP';
    const font = { name: 'Arial' };
    const ws = wb.addWorksheet('الأصول', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    const all = [...COLS.map((c) => ({ label: c.label, width: c.width, note: 'note' in c ? c.note : undefined })), ...ctx.fieldCols.map((f) => ({
      label: f.label, width: 18, note: f.field.type === 'select' ? `خيارات: ${f.field.options?.join('، ')}` : f.field.type === 'date' ? 'تاريخ' : undefined,
    }))];
    ws.columns = all.map((c) => ({ header: c.label, width: c.width }));
    const head = ws.getRow(1);
    head.height = 34;
    head.eachCell((cell, i) => {
      const required = all[i - 1].label.endsWith('*');
      cell.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FF0F766E' : 'FF475569' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      const note = all[i - 1].note;
      if (note) cell.note = note;
    });
    const last = MAX_ROWS + 1;
    const col = (k: ColKey) => COLS.findIndex((c) => c.key === k) + 1;
    const letter = (n: number) => ws.getColumn(n).letter;
    // dataValidations موجودة في exceljs 4.4 وغير معرّفة في أنواعه
    const dv = (ws as unknown as { dataValidations: { add: (range: string, v: ExcelJS.DataValidation) => void } }).dataValidations;
    if (ctx.groups.length) dv.add(`${letter(col('group'))}2:${letter(col('group'))}${last}`, { type: 'list', allowBlank: false, formulae: [`المجموعات!$A$2:$A$${ctx.groups.length + 1}`], showErrorMessage: true, errorTitle: 'رمز المجموعة', error: 'اختر رمز المجموعة من القائمة' });
    if (ctx.emps.length) dv.add(`${letter(col('employee'))}2:${letter(col('employee'))}${last}`, { type: 'list', allowBlank: true, formulae: [`الموظفون!$A$2:$A$${ctx.emps.length + 1}`], showErrorMessage: true, errorTitle: 'الموظف', error: 'اختر رقم موظف من القائمة' });
    for (const k of ['insurance', 'warranty'] as const) dv.add(`${letter(col(k))}2:${letter(col(k))}${last}`, { type: 'list', allowBlank: true, formulae: ['"نعم,لا"'] });
    for (const k of ['purchaseDate', 'warrantyEnd'] as const) ws.getColumn(col(k)).numFmt = 'yyyy-mm-dd';
    for (const k of ['cost', 'accum', 'salvage'] as const) ws.getColumn(col(k)).numFmt = '#,##0.00';
    ctx.fieldCols.forEach((f, i) => {
      const c = COLS.length + 1 + i;
      if (f.field.type === 'select' && f.field.options?.length) dv.add(`${letter(c)}2:${letter(c)}${last}`, { type: 'list', allowBlank: true, formulae: [`"${f.field.options.join(',').replace(/"/g, '')}"`] });
      if (f.field.type === 'date') ws.getColumn(c).numFmt = 'yyyy-mm-dd';
    });

    const gs = wb.addWorksheet('المجموعات', { views: [{ rightToLeft: true }] });
    gs.columns = [{ header: 'الرمز', width: 12 }, { header: 'المجموعة', width: 30 }, { header: 'مادية (تحتاج عهدة)', width: 18 }, { header: 'الحقول الخاصة', width: 50 }];
    for (const g of ctx.groups) gs.addRow([g.code, g.name, g.isTangible ? 'نعم' : 'لا', g.fields.map((f) => `${f.label}${f.required ? ' (إلزامي)' : ''}`).join('، ')]);
    gs.getRow(1).font = { ...font, bold: true };

    const es = wb.addWorksheet('الموظفون', { views: [{ rightToLeft: true }] });
    es.columns = [{ header: 'رقم الموظف', width: 14 }, { header: 'الاسم', width: 32 }];
    for (const e of ctx.emps) es.addRow([e.employeeNo, e.fullName]);
    es.getRow(1).font = { ...font, bold: true };

    const hs = wb.addWorksheet('التعليمات', { views: [{ rightToLeft: true }] });
    hs.getColumn(1).width = 110;
    const lines = [
      'تعليمات نموذج استيراد الأصول الثابتة',
      'سطر لكل أصل في ورقة «الأصول» ابتداءً من السطر الثاني، ولا تغيّر عناوين الأعمدة أو ترتيبها.',
      'الأعمدة الخضراء (المعلَّمة بـ *) إلزامية. الأعمدة الخاصة بمجموعة (مثل «رقم اللوحة (CAR)») تُعبأ لأصول تلك المجموعة فقط.',
      'الأصول المادية يجب أن تكون في عهدة موظف: اكتب رقم الموظف المستلم من ورقة «الموظفون».',
      ctx.openingDate
        ? `إن كتبت التكلفة يُسجَّل للأصل رصيد افتتاحي بتاريخ ${ctx.openingDate} (قبل أول سنة مالية في النظام)، وتاريخ الشراء يكون قبل هذا التاريخ.`
        : 'لا توجد سنة مالية في النظام بعد، فتُسجَّل الأصول بلا قيمة.',
      'الأصل المشترى بعد بداية النظام يُترك بلا تكلفة، ثم يُسجَّل شراؤه من شاشة عمليات الأصول ليصدر سند الصرف.',
      'مجمع الإهلاك لا يتجاوز التكلفة ناقص ريال واحد.',
      'عند الرفع: يُفحص كل صف وتظهر النتيجة «مكتملة» إن قُبلت كل الصفوف، أو «جزئية» إن قُبل بعضها مع قائمة بأخطاء الصفوف المرفوضة، أو «مرفوضة» إن لم يُقبل أي صف.',
      'اختر «الكل أو لا شيء» عند الرفع إن أردت ألا يُستورد أي صف ما دام في الملف خطأ.',
      `الحد الأقصى ${MAX_ROWS} صف في الملف الواحد.`,
    ];
    lines.forEach((t, i) => {
      const r = hs.addRow([t]);
      r.getCell(1).alignment = { wrapText: true, horizontal: 'right' };
      if (i === 0) r.font = { ...font, bold: true, size: 14, color: { argb: 'FF0F766E' } };
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async history(actor: OrgUser) {
    const rows = await this.db.getRepository(AssetImport).find({ where: { organizationId: actor.organizationId }, order: { createdAt: 'DESC' }, take: 50 });
    return rows.map((r) => ({ ...r, statusLabel: STATUS_AR[r.status] }));
  }

  /** رفع النموذج المستكمل */
  async import(actor: OrgUser, file: Express.Multer.File | undefined, mode: string) {
    this.assets.need(actor, P.assetsManage, 'ليست لديك صلاحية تسجيل الأصول');
    if (!file?.buffer?.length) bad('اختر ملف Excel');
    if (!/\.xlsx$/i.test(file!.originalname)) bad('الملف يجب أن يكون Excel بصيغة xlsx (استخدم النموذج المنزَّل من النظام)');
    assertSafeXlsx(file!.buffer);
    const org = actor.organizationId;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file!.buffer as unknown as ArrayBuffer);
    } catch {
      bad('تعذرت قراءة الملف. تأكد أنه ملف Excel سليم');
    }
    const ws = wb.getWorksheet('الأصول') ?? wb.worksheets[0];
    if (!ws) bad('الملف لا يحتوي ورقة «الأصول»');
    const ctx = await this.context(org);
    const header = (ws!.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(cellText);
    const missing = COLS.filter((c, i) => header[i] !== c.label).map((c) => c.label);
    if (missing.length) bad(`الملف ليس نموذج الاستيراد: الأعمدة «${missing.slice(0, 3).join('»، «')}» غير موجودة في مكانها. نزّل النموذج من النظام واستخدمه`);
    const fieldIdx = new Map<string, number>();
    for (const f of ctx.fieldCols) {
      const i = header.indexOf(f.label);
      if (i >= 0) fieldIdx.set(`${f.groupId}:${f.field.key}`, i);
    }
    const strict = mode === 'strict';

    type Parsed = { row: number; name: string | null; messages: string[]; data?: { g: AssetGroup; input: Record<string, unknown>; empId: string | null; purchaseDate: string | null; cost: number | null; accum: number } };
    const parsed: Parsed[] = [];
    const serials = new Map<string, number>();
    const existingSerials = new Set(((await this.db.query(`SELECT lower(serial_number) AS s FROM acc_assets WHERE organization_id = $1 AND serial_number IS NOT NULL`, [org])) as { s: string }[]).map((r) => r.s));
    for (let r = 2; r <= ws!.rowCount; r++) {
      const vals = (ws!.getRow(r).values as ExcelJS.CellValue[]).slice(1).map(cellText);
      if (!vals.some((v) => v)) continue;
      if (parsed.length >= MAX_ROWS) bad(`الملف يتجاوز ${MAX_ROWS} صف`);
      const v = (k: ColKey) => vals[COLS.findIndex((c) => c.key === k)] ?? '';
      const msgs: string[] = [];
      const name = v('name') || null;
      if (!name) msgs.push('اسم الأصل فارغ');
      const g = ctx.groups.find((x) => x.code === v('group').toUpperCase());
      if (!v('group')) msgs.push('رمز المجموعة فارغ');
      else if (!g) msgs.push(`رمز المجموعة «${v('group')}» غير موجود أو المجموعة موقوفة`);
      let empId: string | null = null;
      if (v('employee')) {
        const e = ctx.emps.find((x) => String(x.employeeNo) === v('employee'));
        if (!e) msgs.push(`لا يوجد موظف على رأس العمل برقم ${v('employee')}`);
        else empId = e.id;
      } else if (g?.isTangible && ctx.cfg.requireCustody) msgs.push('الأصل مادي ويجب أن يكون في عهدة موظف: اكتب رقم الموظف المستلم');
      const purchaseDate = v('purchaseDate') ? parseDate(v('purchaseDate')) : null;
      if (v('purchaseDate') && !purchaseDate) msgs.push(`تاريخ الشراء «${v('purchaseDate')}» غير صحيح`);
      const cost = num(v('cost'));
      const accum = num(v('accum')) ?? 0;
      const salvage = num(v('salvage')) ?? 0;
      if (cost !== null && (!Number.isFinite(cost) || cost <= 0)) msgs.push('التكلفة يجب أن تكون رقمًا أكبر من صفر');
      if (!Number.isFinite(accum) || accum < 0) msgs.push('مجمع الإهلاك يجب أن يكون رقمًا موجبًا');
      if (!Number.isFinite(salvage) || salvage < 0) msgs.push('القيمة التخريدية يجب أن تكون رقمًا موجبًا');
      if (cost !== null && Number.isFinite(cost)) {
        if (!ctx.openingDate) msgs.push('لا توجد سنة مالية في النظام، فلا يُسجل رصيد افتتاحي. اترك التكلفة فارغة');
        if (!purchaseDate) msgs.push('اكتب تاريخ الشراء مع التكلفة');
        else if (ctx.openingDate && purchaseDate > ctx.openingDate) msgs.push(`تاريخ الشراء بعد بداية النظام (${ctx.openingDate}): اترك التكلفة فارغة وسجّل الشراء من شاشة العمليات`);
        if (Number.isFinite(accum) && cents(accum) > cents(cost) - 100) msgs.push('مجمع الإهلاك يتجاوز التكلفة ناقص ريال واحد');
      } else if (accum > 0) msgs.push('كتبت مجمع إهلاك بلا تكلفة');
      const serial = v('serial');
      if (serial) {
        const k = serial.toLowerCase();
        if (existingSerials.has(k)) msgs.push(`الرقم التسلسلي ${serial} مسجل لأصل آخر في النظام`);
        if (serials.has(k)) msgs.push(`الرقم التسلسلي ${serial} مكرر في الصف ${serials.get(k)}`);
        serials.set(k, r);
      }
      const insurance = YES.includes(v('insurance').toLowerCase());
      const warranty = YES.includes(v('warranty').toLowerCase());
      const warrantyEnd = v('warrantyEnd') ? parseDate(v('warrantyEnd')) : null;
      if (v('warrantyEnd') && !warrantyEnd) msgs.push(`نهاية الضمان «${v('warrantyEnd')}» غير صحيحة`);
      if (warranty && (!warrantyEnd || !v('warrantyProvider'))) msgs.push('الأصل له ضمان: اكتب جهة الضمان وتاريخ نهايته');
      const fieldValues: Record<string, unknown> = {};
      if (g) {
        for (const f of g.fields) {
          const i = fieldIdx.get(`${g.id}:${f.key}`);
          let val = i === undefined ? '' : vals[i] ?? '';
          if (f.type === 'date' && val) {
            const d = parseDate(val);
            if (!d) msgs.push(`«${f.label}» ليس تاريخًا صحيحًا`);
            val = d ?? val;
          }
          fieldValues[f.key] = val || null;
        }
      }
      const input: Record<string, unknown> = {
        name, description: v('description'), serialNumber: serial, location: v('location'), fieldValues, salvageValue: salvage || null,
        insuranceRequired: insurance, warrantyRequired: warranty, warranty: warranty && warrantyEnd ? { provider: v('warrantyProvider'), endDate: warrantyEnd } : null,
      };
      // فحص البيانات بقواعد بطاقة الأصل نفسها (الحقول الإلزامية والخيارات والأرقام)
      if (g && !msgs.length) {
        await this.assets.assetData(org, input, g).catch((e: Error) => msgs.push(e.message));
      }
      parsed.push({ row: r, name, messages: msgs, data: g && !msgs.length ? { g, input, empId, purchaseDate, cost, accum } : undefined });
    }
    if (!parsed.length) bad('لا توجد صفوف في الملف. اكتب الأصول ابتداءً من السطر الثاني في ورقة «الأصول»');

    const errors = parsed.filter((p) => p.messages.length).map((p) => ({ row: p.row, name: p.name, messages: p.messages }));
    const ok = parsed.filter((p) => !p.messages.length && p.data);
    const created: { id: string; code: string; name: string }[] = [];
    if (ok.length && !(strict && errors.length)) {
      await this.db.transaction(async (em) => {
        await this.assets.lock(em, org);
        for (const p of ok) {
          const { g, input, empId, purchaseDate, cost, accum } = p.data!;
          const data = await this.assets.assetData(org, input, g);
          const assetNo = await this.assets.nextNo(em, 'acc_assets', 'asset_no', org);
          const code = `${ctx.cfg.prefix}-${g.code}-${String(assetNo).padStart(4, '0')}`;
          const emp = empId ? ctx.emps.find((e) => e.id === empId)! : null;
          const a = await em.getRepository(FixedAsset).save(em.create(FixedAsset, {
            organizationId: org, assetNo, code, groupId: g.id, status: 'draft', ...data, unitId: data.unitId ?? emp?.unitId ?? null,
            custodianEmployeeId: null, createdByName: actor.fullName, inServiceDate: cost !== null ? purchaseDate : null,
          }));
          if (emp) await this.assets.addCustody(em, actor, a, { kind: 'issue', toEmployeeId: emp.id, toLocation: a.location, date: ctx.openingDate ?? purchaseDate ?? new Date().toISOString().slice(0, 10), condition: 'مستعمل', notes: 'تسليم عند استيراد الأصل من Excel' });
          if (cost !== null && ctx.openingDate) {
            await em.getRepository(AssetMove).save(em.create(AssetMove, {
              organizationId: org, moveNo: await this.assets.nextNo(em, 'acc_asset_moves', 'move_no', org), assetId: a.id, kind: 'opening', date: ctx.openingDate,
              amount: fromCents(cents(cost)), accumDelta: fromCents(cents(accum)), status: 'done', notes: 'رصيد افتتاحي مستورد من Excel', createdByName: actor.fullName,
            }));
            await this.assets.refresh(em, org, a.id);
            await em.getRepository(FixedAsset).update({ id: a.id }, { inServiceDate: purchaseDate });
          }
          created.push({ id: a.id, code, name: a.name });
        }
      });
    }
    const status: AssetImport['status'] = !created.length ? 'rejected' : errors.length ? 'partial' : 'complete';
    const log = await this.db.getRepository(AssetImport).save(this.db.getRepository(AssetImport).create({
      organizationId: org, fileName: file!.originalname.slice(0, 250), status, total: parsed.length, imported: created.length, errors, assets: created, createdByName: actor.fullName,
    }));
    const message = status === 'complete'
      ? `اكتمل الاستيراد: أُضيف ${created.length} أصل`
      : status === 'partial'
        ? `استيراد جزئي: أُضيف ${created.length} من ${parsed.length} أصل، ورُفض ${errors.length} صف بسبب الأخطاء الموضحة`
        : strict && ok.length
          ? `رُفض الملف: في ${errors.length} صف أخطاء، ولم يُستورد شيء لأنك اخترت «الكل أو لا شيء»`
          : `رُفض الملف: لم يُقبل أي صف (${errors.length} صف فيه أخطاء)`;
    return { ...log, statusLabel: STATUS_AR[status], message, openingDate: ctx.openingDate };
  }
}

const STATUS_AR: Record<AssetImport['status'], string> = { complete: 'مكتملة', partial: 'جزئية', rejected: 'مرفوضة' };
