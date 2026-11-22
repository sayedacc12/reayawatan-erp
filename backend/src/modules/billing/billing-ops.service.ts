import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AsOfQueryDto, BillingSettingsDto } from './billing.dto';
import { BillingCore, addressProblems, blToday, cleanDigits, diffNote, docCode, logEntry, r2 } from './billing-core.service';
import { cleanAddress } from './catalog.service';
import { COMPANY_TAX_PROFILE } from './company-tax';
import { findCompany } from '../../core/company';
import { canReadBilling } from './documents.service';
import { BILLING_MODES, BlSettings, NationalAddress, DOC_KINDS, DOC_TYPES, DocKind, DocType, ISSUED } from './entities/billing.entity';

const money = (n: unknown) => Math.abs(Number(n)).toLocaleString('en', { maximumFractionDigits: 2 });

/** إعدادات الفوترة ولوحتها ومطابقة حساباتها مع الدليل */
@Injectable()
export class BillingOpsService {
  constructor(private readonly db: DataSource, private readonly core: BillingCore) {}

  // ---------------- الإعدادات ----------------

  /**
   * ربط الحسابات الناقصة فقط (للإعدادات الافتراضية): داخل معاملة مع قفل صف الإعدادات، فلا يُعاد أي حقل
   * عدّله مستخدم في اللحظة نفسها، ولا تُمس البيانات الضريبية أو الوضع. يتخطى الشركة إن بدأت الربط مع «فاتورة».
   * يعيد عدد الحقول التي رُبطت، أو null إن كانت الشركة مربوطة أو في مرحلة الربط.
   */
  async linkDefaults(a: OrgUser, fill: Partial<Record<'receivablesAccountId' | 'vatOutputAccountId' | 'revenueAccountId' | 'customerCategoryId', string>>) {
    const org = a.organizationId;
    await this.core.settings(org);
    return this.db.transaction(async (em) => {
      const s = await em.getRepository(BlSettings).createQueryBuilder('s').setLock('pessimistic_write').where('s.organization_id = :org', { org }).getOneOrFail();
      const [z] = await em.query('SELECT stage FROM bl_zatca WHERE organization_id = $1', [org]);
      if (s.mode === 'integrated' || (z && z.stage !== 'none')) return null;
      const natures = { receivablesAccountId: ['assets', 'حساب الذمم المدينة'], vatOutputAccountId: ['liabilities', 'حساب ضريبة المخرجات'], revenueAccountId: ['revenue', 'حساب الإيراد الافتراضي'] } as const;
      const next: Partial<BlSettings> = {};
      for (const [k, [nature, label]] of Object.entries(natures) as [keyof typeof natures, (typeof natures)[keyof typeof natures]][]) {
        const id = fill[k];
        if (!id || s[k]) continue;
        await this.core.account(org, id, nature, label, em);
        next[k] = id;
      }
      if (fill.customerCategoryId && !s.customerCategoryId) {
        const [c] = await em.query('SELECT behavior FROM acc_partner_categories WHERE organization_id = $1 AND id = $2', [org, fill.customerCategoryId]);
        if (c?.behavior === 'customer') next.customerCategoryId = fill.customerCategoryId;
      }
      const n = Object.keys(next).length;
      if (!n) return 0;
      const note = diffNote(s as never, { ...s, ...next } as never, {
        receivablesAccountId: 'حساب العملاء', vatOutputAccountId: 'حساب ضريبة المخرجات', revenueAccountId: 'حساب الإيراد', customerCategoryId: 'تصنيف العملاء',
      });
      await em.getRepository(BlSettings).update({ organizationId: org }, {
        ...next, log: [...s.log, logEntry('ربط الحسابات ضمن الإعدادات الافتراضية', a.fullName, note)].slice(-200), updatedAt: new Date(),
      });
      return n;
    });
  }

  /**
   * تعبئة البيانات الضريبية للشركة من شهادة التسجيل (للإعدادات الافتراضية): الحقول الفارغة فقط داخل معاملة مع قفل الصف،
   * ويُختار وضع «مسجلة» إن اكتملت البيانات وكان النظام غير مفعّل ولا مستندات قيد الإعداد. لا يعمل بعد بدء الربط مع «فاتورة».
   * يعيد عدد الحقول التي عُبئت وما ينقص، أو null إن كانت الشركة مربوطة أو في مرحلة الربط.
   */
  async applyTaxProfile(a: OrgUser) {
    const org = a.organizationId;
    const p = COMPANY_TAX_PROFILE;
    await this.core.settings(org);
    return this.db.transaction(async (em) => {
      const s = await em.getRepository(BlSettings).createQueryBuilder('s').setLock('pessimistic_write').where('s.organization_id = :org', { org }).getOneOrFail();
      const [z] = await em.query('SELECT stage FROM bl_zatca WHERE organization_id = $1', [org]);
      if (s.mode === 'integrated' || (z && z.stage !== 'none')) return null;
      // بيانات شهادة رعاية وطن لا تُكتب إلا في منشأة الشركة (COMPANY_SLUG)
      const company = await findCompany(em);
      if (!company || company.id !== org) return 'not-company' as const;
      const next: Partial<BlSettings> = {};
      if (!s.sellerName) next.sellerName = p.sellerName;
      if (!s.sellerNameEn) next.sellerNameEn = p.sellerNameEn;
      if (!s.vatNumber) next.vatNumber = p.vatNumber;
      if (!s.idType && !s.idNumber) { next.idType = p.idType; next.idNumber = p.idNumber; }
      if (!s.vatEffectiveFrom) {
        const [{ taxed }] = await em.query(
          `SELECT COUNT(*)::int AS taxed FROM bl_documents WHERE organization_id = $1 AND kind = 'invoice' AND status = ANY($2) AND doc_type <> 'nontax'
              AND LEAST(issue_date, COALESCE(supply_date, issue_date)) < $3`, [org, ISSUED, p.vatEffectiveFrom]);
        if (!taxed) next.vatEffectiveFrom = p.vatEffectiveFrom;
      }
      if (!s.address) {
        next.address = { ...p.address };
      } else {
        const fill = Object.fromEntries(Object.entries(p.address).filter(([k, v]) => v && !s.address![k as keyof NationalAddress]));
        if (Object.keys(fill).length) next.address = { ...s.address, ...fill };
      }
      const merged = { ...s, ...next } as BlSettings;
      if (merged.vatRate <= 0) next.vatRate = 15;
      const missing = this.core.readiness({ ...merged, mode: 'registered' } as BlSettings).missing;
      if (s.mode === 'off' && !missing.length && merged.vatEffectiveFrom) {
        const [{ n }] = await em.query(`SELECT COUNT(*)::int AS n FROM bl_documents WHERE organization_id = $1 AND status IN ('draft', 'pending')`, [org]);
        if (!n) next.mode = 'registered';
      }
      const filled = Object.keys(next).length;
      if (filled) {
        const note = diffNote(s as never, { ...s, ...next } as never, {
          mode: 'الوضع', sellerName: 'اسم الشركة', sellerNameEn: 'الاسم بالإنجليزية', vatNumber: 'الرقم الضريبي', idType: 'نوع المعرّف', idNumber: 'رقم المعرّف',
          address: 'العنوان الوطني', vatRate: 'نسبة الضريبة', vatEffectiveFrom: 'تاريخ نفاذ التسجيل',
        });
        await em.getRepository(BlSettings).update({ organizationId: org }, {
          ...next, log: [...s.log, logEntry('تعبئة البيانات الضريبية من شهادة التسجيل ضمن الإعدادات الافتراضية', a.fullName, note)].slice(-200), updatedAt: new Date(),
        });
      }
      return { filled, missing, registered: (next.mode ?? s.mode) === 'registered' };
    });
  }

  async saveSettings(a: OrgUser, dto: BillingSettingsDto) {
    const org = a.organizationId;
    const s = await this.core.settings(org);
    if (s.mode === 'integrated') throw new BadRequestException('الشركة مربوطة مع منصة «فاتورة»، فتُعدّل بياناتها الضريبية من شاشة الربط');
    await this.core.account(org, dto.receivablesAccountId, 'assets', 'حساب الذمم المدينة');
    await this.core.account(org, dto.vatOutputAccountId, 'liabilities', 'حساب ضريبة المخرجات');
    await this.core.account(org, dto.revenueAccountId, 'revenue', 'حساب الإيراد الافتراضي');
    await this.core.analytic(org, dto.analyticId);
    if (dto.customerCategoryId) {
      const [c] = await this.db.query('SELECT behavior FROM acc_partner_categories WHERE organization_id = $1 AND id = $2', [org, dto.customerCategoryId]);
      if (!c) throw new BadRequestException('تصنيف العملاء غير موجود');
      if (c.behavior !== 'customer') throw new BadRequestException('اختر تصنيف شركاء من نوع «عملاء»');
    }
    const address = cleanAddress(dto.address);
    const vatNumber = cleanDigits(dto.vatNumber);
    if (dto.mode === 'registered') {
      const missing: string[] = [];
      if (!vatNumber) missing.push('الرقم الضريبي');
      if (!dto.idType || !dto.idNumber) missing.push('المعرّف الآخر (السجل أو ترخيص الشركة)');
      if (!dto.vatOutputAccountId) missing.push('حساب ضريبة المخرجات');
      missing.push(...addressProblems(address, 'الشركة'));
      if (!dto.vatEffectiveFrom) missing.push('تاريخ نفاذ التسجيل كما في شهادة التسجيل');
      if (missing.length) throw new BadRequestException(`الشركة المسجلة في الضريبة تحتاج: ${missing.join('، ')}`);
      if (dto.vatRate <= 0) throw new BadRequestException('نسبة الضريبة الأساسية للشركة المسجلة أكبر من صفر');
    }
    if (s.mode !== dto.mode && s.mode !== 'off') {
      const [{ n }] = await this.db.query(`SELECT COUNT(*)::int AS n FROM bl_documents WHERE organization_id = $1 AND status IN ('draft', 'pending')`, [org]);
      if (n) throw new BadRequestException(`يوجد ${n} مستند لم يصدر بعد. أصدرها أو ألغها قبل تغيير وضع الشركة الضريبي`);
    }
    const vatEffectiveFrom = dto.vatEffectiveFrom ?? null;
    if (dto.mode === 'registered' && (vatEffectiveFrom ?? null) !== (s.vatEffectiveFrom ?? null)) await this.assertEffectiveDate(org, vatEffectiveFrom);
    if (dto.paymentCashAccountId && !(await this.core.paymentBank(org, dto.paymentCashAccountId))) throw new BadRequestException('الحساب البنكي للسداد غير موجود أو موقوف أو ليس حسابًا بنكيًا');
    const next: Partial<BlSettings> = {
      vatEffectiveFrom, paymentCashAccountId: dto.paymentCashAccountId ?? null,
      mode: dto.mode, sellerName: dto.sellerName ?? null, sellerNameEn: dto.sellerNameEn ?? null, vatNumber, idType: dto.idType ?? null, idNumber: cleanDigits(dto.idNumber),
      address, vatRate: r2(dto.vatRate), receivablesAccountId: dto.receivablesAccountId ?? null, vatOutputAccountId: dto.vatOutputAccountId ?? null,
      revenueAccountId: dto.revenueAccountId ?? null, customerCategoryId: dto.customerCategoryId ?? null, analyticId: dto.analyticId ?? null,
      paymentDays: dto.paymentDays, terms: dto.terms ?? null, separateIssuer: dto.separateIssuer ?? s.separateIssuer,
    };
    const note = diffNote(s as never, next as never, {
      mode: 'الوضع', sellerName: 'اسم الشركة', sellerNameEn: 'الاسم بالإنجليزية', vatNumber: 'الرقم الضريبي', idType: 'نوع المعرّف', idNumber: 'رقم المعرّف',
      address: 'العنوان الوطني', vatRate: 'نسبة الضريبة', receivablesAccountId: 'حساب العملاء', vatOutputAccountId: 'حساب ضريبة المخرجات', revenueAccountId: 'حساب الإيراد',
      customerCategoryId: 'تصنيف العملاء', analyticId: 'مركز التكلفة', paymentDays: 'مدة السداد', terms: 'الشروط', separateIssuer: 'فصل المُعدّ عن المُصدِر',
      vatEffectiveFrom: 'تاريخ نفاذ التسجيل', paymentCashAccountId: 'الحساب البنكي في الفاتورة',
    });
    await this.db.getRepository(BlSettings).update({ organizationId: org }, {
      ...next, log: [...s.log, logEntry('تعديل إعدادات الفوترة', a.fullName, note)].slice(-200), updatedAt: new Date(),
    });
    return this.core.lookups(org);
  }

  /**
   * تغيير تاريخ نفاذ التسجيل لا يجعل مستندًا صادرًا مخالفًا له: لا فاتورة ضريبية صادرة قبل التاريخ الجديد،
   * ولا فاتورة عادية صادرة بعده (والإشعارات تتبع فاتورتها الأصلية فلا تدخل في الفحص).
   */
  private async assertEffectiveDate(org: string, from: string | null) {
    const [r] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE doc_type <> 'nontax' AND $2::date IS NOT NULL AND LEAST(issue_date, COALESCE(supply_date, issue_date)) < $2::date)::int AS taxed,
              COUNT(*) FILTER (WHERE doc_type = 'nontax' AND ($2::date IS NULL OR LEAST(issue_date, COALESCE(supply_date, issue_date)) >= $2::date))::int AS plain
         FROM bl_documents WHERE organization_id = $1 AND kind = 'invoice' AND status = ANY($3)`, [org, from, ISSUED]);
    if (r.taxed) throw new BadRequestException(`صدرت ${r.taxed} فاتورة ضريبية قبل ${from}، فلا يكون تاريخ نفاذ التسجيل بعدها`);
    if (r.plain) throw new BadRequestException(`صدرت ${r.plain} فاتورة عادية بلا ضريبة بعد هذا التاريخ، فلا يكون تاريخ نفاذ التسجيل قبلها`);
  }

  // ---------------- اللوحة ----------------

  async dashboard(a: OrgUser) {
    if (!canReadBilling(a)) throw new ForbiddenException('لا تملك صلاحية عرض الفوترة');
    const org = a.organizationId;
    const s = await this.core.settings(org);
    const today = blToday();
    const monthStart = `${today.slice(0, 7)}-01`;
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const [k] = await this.db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -taxable ELSE taxable END) FILTER (WHERE status = ANY($2) AND issue_date >= $3), 0)::float AS "salesMonth",
         COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -vat ELSE vat END) FILTER (WHERE status = ANY($2) AND issue_date >= $3), 0)::float AS "vatMonth",
         COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -taxable ELSE taxable END) FILTER (WHERE status = ANY($2) AND issue_date >= $4), 0)::float AS "salesYear",
         COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -vat ELSE vat END) FILTER (WHERE status = ANY($2) AND issue_date >= $4), 0)::float AS "vatYear",
         COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE kind = 'invoice' AND status IN ('issued', 'partial'))::int AS open,
         COALESCE(SUM(total + debited_amount - credited_amount - paid_amount) FILTER (WHERE kind = 'invoice' AND status IN ('issued', 'partial')), 0)::float AS outstanding,
         COUNT(*) FILTER (WHERE kind = 'invoice' AND status IN ('issued', 'partial') AND due_date < $5)::int AS overdue,
         COALESCE(SUM(total + debited_amount - credited_amount - paid_amount) FILTER (WHERE kind = 'invoice' AND status IN ('issued', 'partial') AND due_date < $5), 0)::float AS "overdueAmount"
         FROM bl_documents WHERE organization_id = $1`, [org, ISSUED, monthStart, yearStart, today]);
    const monthly: { m: string; sales: number; vat: number }[] = await this.db.query(
      `SELECT to_char(issue_date, 'YYYY-MM') AS m, SUM(CASE WHEN kind = 'credit_note' THEN -taxable ELSE taxable END)::float AS sales,
              SUM(CASE WHEN kind = 'credit_note' THEN -vat ELSE vat END)::float AS vat
         FROM bl_documents WHERE organization_id = $1 AND status = ANY($2) AND issue_date >= ($3::date - INTERVAL '11 months') GROUP BY 1 ORDER BY 1`, [org, ISSUED, monthStart]);
    const top = await this.db.query(
      `SELECT d.customer_id AS id, COALESCE(c.name, d.buyer->>'name', 'عميل نقدي') AS name, SUM(CASE WHEN d.kind = 'credit_note' THEN -d.total ELSE d.total END)::float AS total
         FROM bl_documents d LEFT JOIN bl_customers c ON c.id = d.customer_id AND c.organization_id = d.organization_id
        WHERE d.organization_id = $1 AND d.status = ANY($2) AND d.issue_date >= $3 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 5`, [org, ISSUED, yearStart]);
    const recent = await this.db.query(
      `SELECT id, kind, doc_no AS "docNo", doc_type AS "docType", status, issue_date::text AS date, total::float AS total, COALESCE(buyer->>'name', 'عميل نقدي') AS buyer
         FROM bl_documents WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 8`, [org]);
    const [counts] = await this.db.query(
      `SELECT (SELECT COUNT(*)::int FROM bl_customers WHERE organization_id = $1 AND is_active) AS customers,
              (SELECT COUNT(*)::int FROM bl_items WHERE organization_id = $1 AND is_active) AS items`, [org]);
    // تقدير الحد الإلزامي للتسجيل في الضريبة: إيراد خاضع يتجاوز 375 ألف ريال سنويًا، واختياري فوق 187,500
    const [last12] = await this.db.query(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -taxable ELSE taxable END), 0)::float AS v
         FROM bl_documents WHERE organization_id = $1 AND status = ANY($2) AND issue_date > ($3::date - INTERVAL '12 months')`, [org, ISSUED, today]);
    const rec = await this.reconcile(a, {});
    return {
      mode: s.mode, modeLabel: BILLING_MODES[s.mode], readiness: this.core.readiness(s),
      kpis: { ...k, ...counts, last12: last12.v },
      monthly, top,
      recent: recent.map((r: { kind: DocKind; docNo: number; docType: DocType }) => ({ ...r, code: docCode(r.kind, r.docNo), kindLabel: DOC_KINDS[r.kind], typeLabel: DOC_TYPES[r.docType] })),
      reconciliation: { ok: rec.ok, issues: rec.issues },
      thresholds: { mandatory: 375_000, voluntary: 187_500 },
    };
  }

  // ---------------- المطابقة مع الدليل ----------------

  /**
   * مطابقة رصيد حساب الذمم وحساب ضريبة المخرجات في الدليل مع ما يقابلهما في نظام الفوترة حتى تاريخ معين.
   * عند الاختلاف علامة حمراء وأسبابه: قيود يدوية أو من أنظمة أخرى على الحساب.
   */
  async reconcile(a: OrgUser, q: AsOfQueryDto) {
    if (!canReadBilling(a)) throw new ForbiddenException('لا تملك صلاحية عرض الفوترة');
    const org = a.organizationId;
    const asOf = q.asOf ?? blToday();
    const s = await this.core.settings(org);
    const accIds = [...new Set([s.receivablesAccountId, s.vatOutputAccountId].filter(Boolean))] as string[];
    if (!accIds.length) return { asOf, accounts: [], ok: true, issues: 0 };
    const accs: { id: string; code: string; name: string }[] = await this.db.query('SELECT id, code, name FROM acc_accounts WHERE organization_id = $1 AND id = ANY($2)', [org, accIds]);
    const gl: { account_id: string; bal: string }[] = await this.db.query(
      `SELECT l.account_id, SUM(l.debit - l.credit) AS bal FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
        WHERE e.organization_id = $1 AND e.status = 'posted' AND e.document_date <= $2 AND l.account_id = ANY($3) GROUP BY 1`, [org, asOf, accIds]);
    const [docs] = await this.db.query(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -total ELSE total END), 0) AS ar, COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -vat ELSE vat END), 0) AS vat
         FROM bl_documents WHERE organization_id = $1 AND status = ANY($2) AND issue_date <= $3`, [org, ISSUED, asOf]);
    // التحصيل من سندات القبض المعتمدة بقيودها المرحّلة
    const [paid] = await this.db.query(
      `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS v FROM acc_vouchers v JOIN acc_entries e ON e.voucher_id = v.id AND e.organization_id = v.organization_id
         JOIN acc_entry_lines l ON l.entry_id = e.id
        WHERE v.organization_id = $1 AND v.source_type = 'billing' AND e.status = 'posted' AND e.document_date <= $2 AND l.account_id = $3`, [org, asOf, s.receivablesAccountId]);
    const foreign: { account_id: string; entry_id: string; entry_no: number; date: string; description: string; amount: string }[] = await this.db.query(
      `SELECT l.account_id, e.id AS entry_id, e.entry_no, to_char(e.document_date, 'YYYY-MM-DD') AS date, e.description, (l.debit - l.credit) AS amount
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id LEFT JOIN acc_vouchers v ON v.id = e.voucher_id
        WHERE e.organization_id = $1 AND e.status = 'posted' AND e.document_date <= $2 AND l.account_id = ANY($3)
          AND e.source <> 'billing' AND NOT (e.source = 'voucher' AND COALESCE(v.source_type, '') = 'billing')
        ORDER BY e.document_date, e.entry_no LIMIT 200`, [org, asOf, accIds]);
    const rows = [
      { id: s.receivablesAccountId, kind: 'receivables', kindLabel: 'حساب الذمم المدينة (العملاء)', sign: 1, sub: r2(Number(docs.ar) - Number(paid.v)), what: 'المتبقي على الفواتير الصادرة بعد الإشعارات والتحصيل' },
      { id: s.vatOutputAccountId, kind: 'vat', kindLabel: 'حساب ضريبة المخرجات', sign: -1, sub: r2(Number(docs.vat)), what: 'ضريبة الفواتير والإشعارات الصادرة' },
    ].filter((r) => r.id);
    // إن كان الحساب نفسه للغرضين (حالة نادرة) تُجمع المقارنة في سطر واحد
    const accounts = rows.map((r) => {
      const acc = accs.find((x) => x.id === r.id);
      const glBal = r2(r.sign * Number(gl.find((x) => x.account_id === r.id)?.bal ?? 0));
      const subTotal = rows.filter((x) => x.id === r.id).reduce((t, x) => r2(t + x.sub * (x.sign === r.sign ? 1 : -1)), 0);
      const diff = r2(glBal - subTotal);
      const fe = foreign.filter((f) => f.account_id === r.id);
      const problems = diff === 0 ? [] : [
        ...fe.slice(0, 10).map((f) => `قيد رقم ${f.entry_no} بتاريخ ${f.date} بمبلغ ${money(f.amount)} ريال لم يصدر من نظام الفوترة: ${f.description}`),
        ...(fe.length ? [] : ['راجع كشف حساب هذا الحساب مقارنة بالفواتير الصادرة وسندات القبض']),
      ];
      return {
        accountId: r.id, code: acc?.code ?? '', name: acc?.name ?? '', kind: r.kind, kindLabel: r.kindLabel, description: r.what,
        gl: glBal, subledger: subTotal, diff, ok: diff === 0, problems,
        foreignEntries: fe.map((f) => ({ id: f.entry_id, entryNo: f.entry_no, date: f.date, description: f.description, amount: Number(f.amount) })),
      };
    });
    const issues = accounts.filter((x) => !x.ok).length;
    return { asOf, accounts, ok: issues === 0, issues };
  }
}
