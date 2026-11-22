import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Organization } from '../../core/entities';
import { LookupsService } from '../../core/lookups/lookups.service';
import { accessProblem } from '../../core/organizations/org-access';
import {
  ApprovalStage, GATEWAYS, GatewayProvider, MemMember, MembershipType, MemSettings, PaymentConfig,
} from './entities/members.entity';
import {
  DEFAULT_ACCOUNTING, DEFAULT_CARD, DEFAULT_CONDITIONS, DEFAULT_DOCUMENTS, DEFAULT_PAYMENT, DEFAULT_REGULATION, DEFAULT_RENEWAL, DEFAULT_STAGES, DEFAULT_TYPES,
} from './members-defaults';
import { MEMBER_PERMISSIONS as P } from './members.manifest';
import { addDays, daysBetween, normalizeConditions, normalizeDocuments, normalizeFields, normalizeSections, normalizeTypes } from './mem-forms';

/** اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
/** رمز عشوائي للروابط العامة (رابط السداد) */
export const token = (bytes = 16) => randomBytes(bytes).toString('hex');
/** رمز قصير يسهل كتابته (متابعة الطلب والتحقق من البطاقة) */
export const shortCode = () => randomBytes(5).toString('hex').toUpperCase();

export type SettingsSection = 'general' | 'types' | 'conditions' | 'regulation' | 'form' | 'stages' | 'payment' | 'accounting' | 'renewal' | 'card';
export const SETTINGS_SECTIONS: SettingsSection[] = ['general', 'types', 'conditions', 'regulation', 'form', 'stages', 'payment', 'accounting', 'renewal', 'card'];
type Counter = 'nextApplicationNo' | 'nextMemberNo' | 'nextInvoiceNo';

/** الحالة الفعلية للعضو: المسجلة، أو منتهية إن تجاوز تاريخ النهاية */
export type EffectiveStatus = 'active' | 'expiring' | 'grace' | 'expired' | 'suspended' | 'terminated';
export const MEMBER_STATUS_AR: Record<EffectiveStatus, string> = {
  active: 'سارية', expiring: 'تنتهي قريبًا', grace: 'منتهية (مهلة السماح)', expired: 'منتهية', suspended: 'موقوفة', terminated: 'منتهية بقرار',
};

const UUID = /^[0-9a-f-]{36}$/i;

/** الإعدادات والترقيم والحالة وحق التصويت: مشتركة بين خدمات العضوية */
@Injectable()
export class MemCore {
  constructor(private readonly db: DataSource, private readonly lookupsService: LookupsService) {}

  /** الشركة من معرفها في الرابط العام، مع منع الشركة الموقوفة أو المنتهي اشتراكها */
  async organization(slug: string) {
    const org = await this.db.getRepository(Organization).findOne({ where: { slug: String(slug).toLowerCase() } });
    if (!org) throw new NotFoundException('الشركة غير موجودة');
    if (accessProblem(org)) throw new NotFoundException('صفحة الشركة غير متاحة حاليًا');
    return org;
  }

  async orgName(org: string, em: EntityManager = this.db.manager) {
    const [o] = await em.query('SELECT name, slug FROM organizations WHERE id = $1', [org]);
    return o as { name: string; slug: string };
  }

  /** إعدادات الشركة، وتُعبأ بالقيم الافتراضية عند أول استخدام */
  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(MemSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    if (!s.initialized) {
      const init = {
        types: DEFAULT_TYPES, conditions: DEFAULT_CONDITIONS, regulation: DEFAULT_REGULATION, documents: DEFAULT_DOCUMENTS, stages: DEFAULT_STAGES,
        payment: DEFAULT_PAYMENT, accounting: DEFAULT_ACCOUNTING, renewal: DEFAULT_RENEWAL, card: DEFAULT_CARD, initialized: true,
      };
      Object.assign(s, init);
      await repo.update({ organizationId: org, initialized: false }, init);
    }
    s.payment = { ...DEFAULT_PAYMENT, ...s.payment };
    s.accounting = { ...DEFAULT_ACCOUNTING, ...s.accounting };
    s.renewal = { ...DEFAULT_RENEWAL, ...s.renewal };
    s.card = { ...DEFAULT_CARD, ...s.card };
    return s;
  }

  /** إعدادات الدفع بدون المفتاح السري */
  publicPayment(p: PaymentConfig) {
    const { secretKey, ...rest } = p;
    return { ...rest, hasSecretKey: !!secretKey };
  }

  async getSettings(actor: OrgUser) {
    const org = actor.organizationId;
    const s = await this.settings(org);
    const [roles, accounts, cashAccounts] = await Promise.all([
      this.db.query('SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name', [org]),
      this.db.query(`SELECT id, code, name, nature FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active ORDER BY code`, [org]),
      this.db.query(`SELECT id, name, kind FROM acc_cash_accounts WHERE organization_id = $1 AND is_active ORDER BY kind, name`, [org]),
    ]);
    return {
      publicEnabled: s.publicEnabled, intro: s.intro, types: s.types, conditions: s.conditions, regulation: s.regulation,
      applicationFields: s.applicationFields, documents: s.documents, stages: s.stages, payment: this.publicPayment(s.payment),
      accounting: s.accounting, renewal: s.renewal, card: s.card, slug: actor.organizationSlug,
      roles, accounts, cashAccounts, gateways: GATEWAYS,
    };
  }

  nationalities(org: string) {
    return this.lookupsService.nationalities(org);
  }

  /** القوائم المستخدمة في الشاشات (بدون صلاحية الإعدادات) */
  async lookups(org: string) {
    const s = await this.settings(org);
    return {
      types: s.types, conditions: s.conditions, applicationFields: s.applicationFields, documents: s.documents, stages: s.stages,
      nationalities: await this.lookupsService.nationalities(org), publicEnabled: s.publicEnabled,
      payment: { online: s.payment.online, transfer: s.payment.transfer, cash: s.payment.cash, provider: s.payment.provider },
      renewal: { reminderDays: s.renewal.reminderDays, graceDays: s.renewal.graceDays, message: s.renewal.message },
      card: s.card, regulation: s.regulation,
    };
  }

  private async assertAccount(org: string, id: string | null | undefined, label: string) {
    if (!id) return null;
    if (!UUID.test(id)) throw new BadRequestException(`${label}: الحساب غير موجود`);
    const [a] = await this.db.query('SELECT code, name, kind, is_active FROM acc_accounts WHERE id = $1 AND organization_id = $2', [id, org]);
    if (!a) throw new BadRequestException(`${label}: الحساب غير موجود في دليل الحسابات`);
    if (a.kind !== 'sub') throw new BadRequestException(`${label}: الحساب ${a.code} «${a.name}» ليس حسابًا فرعيًا`);
    if (!a.is_active) throw new BadRequestException(`${label}: الحساب ${a.code} «${a.name}» موقوف`);
    return id;
  }

  private async assertCash(org: string, id: string | null | undefined, label: string) {
    if (!id) return null;
    if (!UUID.test(id)) throw new BadRequestException(`${label}: البنك أو الصندوق غير موجود`);
    const [c] = await this.db.query('SELECT name, is_active FROM acc_cash_accounts WHERE id = $1 AND organization_id = $2', [id, org]);
    if (!c) throw new BadRequestException(`${label}: البنك أو الصندوق غير موجود`);
    if (!c.is_active) throw new BadRequestException(`${label}: «${c.name}» موقوف`);
    return id;
  }

  /** حفظ قسم واحد من الإعدادات (كل تبويب يحفظ قسمه) */
  async saveSettings(actor: OrgUser, section: SettingsSection, body: Record<string, unknown>) {
    const org = actor.organizationId;
    const s = await this.settings(org);
    const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
    switch (section) {
      case 'general':
        s.publicEnabled = body.publicEnabled !== false;
        s.intro = str(body.intro, 3000) || null;
        break;
      case 'types': {
        const used: { code: string }[] = await this.db.query(
          `SELECT type_code AS code FROM mem_members WHERE organization_id = $1 UNION SELECT type_code FROM mem_applications WHERE organization_id = $1`, [org]);
        const types = normalizeTypes(body.types, new Set(used.map((u) => u.code)));
        for (const t of types) await this.assertAccount(org, t.revenueAccountId, `حساب إيراد «${t.name}»`);
        s.types = types;
        break;
      }
      case 'conditions':
        s.conditions = normalizeConditions(body.conditions);
        break;
      case 'regulation': {
        const title = str(body.title, 200);
        if (!title) throw new BadRequestException('اكتب عنوان أحكام العضوية');
        const effectiveDate = typeof body.effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate) ? body.effectiveDate : today();
        s.regulation = { title, sections: normalizeSections(body.sections), version: (s.regulation?.version ?? 0) + 1, effectiveDate, updatedByName: actor.fullName };
        break;
      }
      case 'form':
        s.applicationFields = normalizeFields(body.applicationFields, 'نموذج طلب العضوية');
        s.documents = normalizeDocuments(body.documents);
        break;
      case 'stages':
        s.stages = await this.normalizeStages(org, body.stages);
        break;
      case 'payment': {
        const provider = body.provider as GatewayProvider;
        if (!GATEWAYS.includes(provider)) throw new BadRequestException('اختر بوابة الدفع');
        const dueDays = Number(body.dueDays ?? 14);
        if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 180) throw new BadRequestException('مهلة السداد من 1 إلى 180 يومًا');
        const iban = str(body.iban, 34).replace(/\s/g, '').toUpperCase();
        if (iban && !/^SA\d{22}$/.test(iban)) throw new BadRequestException('رقم الآيبان غير صحيح، مثال: SA0380000000608010167519');
        // المفتاح السري يُحفظ فقط إن أُرسل جديد، ويُحذف بإرسال clearSecret
        const secret = str(body.secretKey, 200);
        const p: PaymentConfig = {
          online: !!body.online, transfer: !!body.transfer, cash: !!body.cash, provider,
          publishableKey: str(body.publishableKey, 200) || null,
          secretKey: body.clearSecret ? null : secret || s.payment.secretKey,
          bankName: str(body.bankName, 120) || null, accountName: str(body.accountName, 200) || null, iban: iban || null, dueDays,
        };
        if (!p.online && !p.transfer && !p.cash) throw new BadRequestException('فعّل طريقة سداد واحدة على الأقل');
        if (p.online && provider === 'moyasar' && !p.secretKey) throw new BadRequestException('أدخل المفتاح السري لبوابة ميسر، أو اختر البيئة التجريبية');
        if (p.transfer && !p.iban) throw new BadRequestException('أدخل رقم الآيبان لحساب التحويل البنكي');
        s.payment = p;
        break;
      }
      case 'accounting':
        s.accounting = {
          revenueAccountId: await this.assertAccount(org, body.revenueAccountId as string, 'حساب إيراد الاشتراكات'),
          onlineCashAccountId: await this.assertCash(org, body.onlineCashAccountId as string, 'حساب تحصيل الدفع الإلكتروني'),
          transferCashAccountId: await this.assertCash(org, body.transferCashAccountId as string, 'حساب التحويلات البنكية'),
          cashCashAccountId: await this.assertCash(org, body.cashCashAccountId as string, 'صندوق التحصيل النقدي'),
        };
        break;
      case 'renewal': {
        const days = Array.isArray(body.reminderDays) ? [...new Set(body.reminderDays.map(Number))].filter((n) => Number.isInteger(n) && n > 0 && n <= 365).sort((a, b) => b - a).slice(0, 5) : [];
        if (!days.length) throw new BadRequestException('حدد يومًا واحدًا على الأقل للتنبيه قبل الانتهاء');
        const graceDays = Number(body.graceDays ?? 0);
        if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 365) throw new BadRequestException('مهلة السماح من صفر إلى 365 يومًا');
        const auto = body.autoInvoiceDays === null || body.autoInvoiceDays === '' || body.autoInvoiceDays === undefined ? null : Number(body.autoInvoiceDays);
        if (auto !== null && (!Number.isInteger(auto) || auto < 1 || auto > 120)) throw new BadRequestException('الإصدار التلقائي لمطالبة التجديد من 1 إلى 120 يومًا قبل الانتهاء');
        const message = str(body.message, 2000);
        if (!message) throw new BadRequestException('اكتب نص رسالة التذكير');
        s.renewal = { reminderDays: days, graceDays, autoInvoiceDays: auto, message };
        break;
      }
      case 'card': {
        const title = str(body.title, 100);
        if (!title) throw new BadRequestException('اكتب عنوان بطاقة العضوية');
        s.card = { title, signatoryName: str(body.signatoryName, 150), signatoryTitle: str(body.signatoryTitle, 150), note: str(body.note, 500) };
        break;
      }
      default:
        throw new BadRequestException('قسم الإعدادات غير معروف');
    }
    await this.db.getRepository(MemSettings).save(s);
    return this.getSettings(actor);
  }

  private async normalizeStages(org: string, input: unknown): Promise<ApprovalStage[]> {
    if (!Array.isArray(input) || !input.length) throw new BadRequestException('أضف مرحلة اعتماد واحدة على الأقل لطلبات العضوية');
    if (input.length > 8) throw new BadRequestException('أقصى عدد مراحل اعتماد 8 مراحل');
    const stages = input.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const name = String(r.name ?? '').trim().slice(0, 100);
      if (!name) throw new BadRequestException(`اكتب اسم المرحلة رقم ${i + 1}`);
      const roleId = typeof r.roleId === 'string' && r.roleId ? r.roleId : null;
      return { name, roleId };
    });
    const roleIds = stages.map((s) => s.roleId).filter((x): x is string => !!x);
    if (roleIds.some((id) => !UUID.test(id))) throw new BadRequestException('أحد الأدوار المختارة غير موجود');
    const found: { id: string }[] = roleIds.length ? await this.db.query('SELECT id FROM roles WHERE organization_id = $1 AND id = ANY($2)', [org, roleIds]) : [];
    if (found.length !== new Set(roleIds).size) throw new BadRequestException('أحد الأدوار المختارة غير موجود');
    return stages;
  }

  type(s: MemSettings, code: string | null | undefined): MembershipType | undefined {
    return s.types.find((t) => t.code === code);
  }

  typeName(s: MemSettings, code: string) {
    return this.type(s, code)?.name ?? code;
  }

  /** رقم تسلسلي داخل معاملة، مع قفل صف الإعدادات */
  async nextNo(em: EntityManager, org: string, field: Counter) {
    await this.settings(org, em);
    const s = await em.getRepository(MemSettings).createQueryBuilder('s').setLock('pessimistic_write').where('s.organization_id = :org', { org }).getOneOrFail();
    const n = s[field];
    await em.getRepository(MemSettings).update({ organizationId: org }, { [field]: n + 1 });
    return n;
  }

  // ---------------- الحالة وحق التصويت ----------------

  effectiveStatus(m: Pick<MemMember, 'status' | 'endDate'>, s: MemSettings, on = today()): EffectiveStatus {
    if (m.status === 'suspended' || m.status === 'terminated') return m.status;
    const left = daysBetween(on, m.endDate);
    if (left < 0) return -left <= s.renewal.graceDays ? 'grace' : 'expired';
    if (left <= Math.max(...s.renewal.reminderDays, 0)) return 'expiring';
    return 'active';
  }

  /** حق التصويت: نوع عضوية له حق التصويت، وعضوية سارية، ومضت المدة المحددة من الانضمام */
  voting(m: Pick<MemMember, 'status' | 'endDate' | 'joinedOn' | 'typeCode'>, s: MemSettings, on = today()) {
    const t = this.type(s, m.typeCode);
    if (!t?.votingRights) return { eligible: false, reason: 'نوع العضوية بدون حق تصويت', from: null as string | null };
    const st = this.effectiveStatus(m, s, on);
    const from = addDays(m.joinedOn, t.votingAfterDays);
    if (st !== 'active' && st !== 'expiring') return { eligible: false, reason: 'العضوية غير سارية', from };
    if (from > on) return { eligible: false, reason: `يكتسب حق التصويت من ${from}`, from };
    return { eligible: true, reason: null, from };
  }

  /** هل للمستخدم القرار في مرحلة الاعتماد الحالية؟ */
  async canDecide(actor: OrgUser, stage: ApprovalStage | undefined) {
    if (!actor.isSuperadmin && !actor.permissions.includes(P.approve)) return false;
    if (!stage?.roleId || actor.isSuperadmin) return true;
    const rows: { role_id: string }[] = await this.db.query('SELECT role_id FROM effective_user_roles WHERE user_id = $1', [actor.id]);
    return rows.some((r) => r.role_id === stage.roleId);
  }
}
