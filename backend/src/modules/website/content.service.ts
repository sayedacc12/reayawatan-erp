import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { findCompany } from '../../core/company';
import { EMAIL_RE } from '../../core/mail/mail-settings';
import { ContentEvent, SiteContent, SiteService as ServiceRow } from './entities/website.entity';
import { BookingSettings, CONTENT_KEYS, ContentKey, DEFAULT_CONTENT, DEFAULT_SERVICES, NotifySettings, PRIVATE_KEYS } from './website-defaults';
import { ServiceDto } from './website.dto';

const MAX_TEXT = 6000;
const MAX_LIST = 60;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ينظّف قيمة قسم محتوى بمقارنتها بشكل القيمة الافتراضية: نفس المفاتيح ونفس الأنواع فقط،
 * فلا يُحفظ حقل غير معروف ولا نوع مختلف (المحتوى يُعرض في الموقع نصًا عاديًا بلا HTML).
 */
function shape(def: unknown, val: unknown, path: string, depth = 0): unknown {
  if (depth > 5) throw new BadRequestException(`بنية المحتوى أعمق من المسموح: ${path}`);
  if (typeof def === 'string') {
    if (typeof val !== 'string') throw new BadRequestException(`الحقل ${path} نص`);
    if (val.length > MAX_TEXT) throw new BadRequestException(`الحقل ${path} أطول من المسموح`);
    return val;
  }
  if (typeof def === 'number') {
    if (typeof val !== 'number' || !Number.isFinite(val)) throw new BadRequestException(`الحقل ${path} رقم`);
    return val;
  }
  if (typeof def === 'boolean') {
    if (typeof val !== 'boolean') throw new BadRequestException(`الحقل ${path} نعم/لا`);
    return val;
  }
  if (Array.isArray(def)) {
    if (!Array.isArray(val)) throw new BadRequestException(`الحقل ${path} قائمة`);
    if (val.length > MAX_LIST) throw new BadRequestException(`القائمة ${path} أطول من المسموح`);
    // عنصر القالب: أول عنصر في القيمة الافتراضية (قوائم الأيام المغلقة فارغة افتراضيًا فهي نصوص)
    const tpl = def.length ? def[0] : '';
    return val.map((v, i) => shape(tpl, v, `${path}[${i + 1}]`, depth + 1));
  }
  if (def && typeof def === 'object') {
    if (!val || typeof val !== 'object' || Array.isArray(val)) throw new BadRequestException(`الحقل ${path} غير صحيح`);
    const out: Record<string, unknown> = {};
    for (const [k, d] of Object.entries(def)) {
      const v = (val as Record<string, unknown>)[k];
      out[k] = v === undefined ? d : shape(d, v, path ? `${path}.${k}` : k, depth + 1);
    }
    return out;
  }
  throw new BadRequestException(`الحقل ${path} غير مدعوم`);
}

/**
 * المحتوى المحفوظ فوق الافتراضي. الحقل النصي المحفوظ وهو ما زال معلّقًا ({{...}}) يأخذ القيمة الافتراضية
 * إن صارت معتمدة (بلا {{ }})، فتصل البيانات المعتمدة الجديدة مع التحديث دون إدخال يدوي.
 */
export function withDefaults(key: ContentKey, saved: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const def = DEFAULT_CONTENT[key] as Record<string, unknown>;
  const out: Record<string, unknown> = { ...def, ...(saved ?? {}) };
  for (const [k, v] of Object.entries(saved ?? {})) {
    const d = def[k];
    if (typeof v === 'string' && v.includes('{{') && typeof d === 'string' && !d.includes('{{')) out[k] = d;
  }
  return out;
}

@Injectable()
export class ContentService {
  constructor(private readonly db: DataSource) {}

  /** منشأة الشركة للموقع العام (وضع الشركة الواحدة) */
  async companyId(em: EntityManager = this.db.manager): Promise<string> {
    const org = await findCompany(em);
    if (!org || !org.isActive) throw new NotFoundException('الموقع غير متاح');
    return org.id;
  }

  async section<T = Record<string, unknown>>(org: string, key: ContentKey, em: EntityManager = this.db.manager): Promise<T> {
    const row = await em.findOne(SiteContent, { where: { organizationId: org, key } });
    return withDefaults(key, row?.data) as T;
  }

  booking(org: string, em?: EntityManager) {
    return this.section<BookingSettings>(org, 'booking', em);
  }

  notify(org: string) {
    return this.section<NotifySettings>(org, 'notify');
  }

  async sections(org: string) {
    const rows = await this.db.getRepository(SiteContent).find({ where: { organizationId: org } });
    const saved = new Map(rows.map((r) => [r.key, r]));
    return CONTENT_KEYS.map((key) => ({
      key,
      data: withDefaults(key, saved.get(key)?.data),
      defaults: DEFAULT_CONTENT[key],
      updatedAt: saved.get(key)?.updatedAt ?? null,
    }));
  }

  async saveSection(u: OrgUser, key: string, data: Record<string, unknown>) {
    if (!(CONTENT_KEYS as readonly string[]).includes(key)) throw new BadRequestException('القسم غير معروف');
    const k = key as ContentKey;
    const clean = shape(DEFAULT_CONTENT[k], data, '') as Record<string, unknown>;
    if (k === 'booking') this.checkBooking(clean as unknown as BookingSettings);
    if (k === 'assessment') {
      const q = (clean as { questions: { text: string }[]; options: string[] });
      if (q.questions.length < 1 || q.questions.length > 20) throw new BadRequestException('التقييم من سؤال واحد إلى عشرين سؤالًا');
      if (q.questions.some((x) => !x.text.trim())) throw new BadRequestException('اكتبوا نص كل سؤال');
      if (q.options.length !== 3) throw new BadRequestException('خيارات الإجابة ثلاثة: نعم، جزئيًا، لا');
    }
    if (k === 'notify') {
      const n = clean as unknown as NotifySettings;
      n.emails = [...new Set(n.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const bad = n.emails.filter((e) => !EMAIL_RE.test(e));
      if (bad.length) throw new BadRequestException(`بريد غير صحيح: ${bad.join('، ')}`);
      if (n.emails.length > 10) throw new BadRequestException('عشرة عناوين بريد كحد أعلى');
    }
    const prev = await this.db.getRepository(SiteContent).findOne({ where: { organizationId: u.organizationId, key: k } });
    await this.db.getRepository(SiteContent).upsert({ organizationId: u.organizationId, key: k, data: clean as never, updatedBy: u.id }, ['organizationId', 'key']);
    await this.audit(u, 'content', 'save', k, prev?.data ?? null, clean);
    return { key: k, data: clean };
  }

  async resetSection(u: OrgUser, key: string) {
    if (!(CONTENT_KEYS as readonly string[]).includes(key)) throw new BadRequestException('القسم غير معروف');
    const prev = await this.db.getRepository(SiteContent).findOne({ where: { organizationId: u.organizationId, key } });
    await this.db.getRepository(SiteContent).delete({ organizationId: u.organizationId, key });
    if (prev) await this.audit(u, 'content', 'reset', key, prev.data, null);
    return { key, data: DEFAULT_CONTENT[key as ContentKey] };
  }

  private checkBooking(b: BookingSettings) {
    const range = (v: number, min: number, max: number, label: string) => {
      if (!Number.isInteger(v) || v < min || v > max) throw new BadRequestException(`${label} بين ${min} و${max}`);
    };
    range(b.slotMinutes, 15, 180, 'مدة الجلسة بالدقائق');
    range(b.bufferMinutes, 0, 120, 'الفاصل بين الجلسات بالدقائق');
    range(b.minNoticeHours, 0, 336, 'أقل مدة قبل الموعد بالساعات');
    range(b.horizonDays, 1, 90, 'أيام الحجز المتاحة مقدمًا');
    if (b.weekly.length > 21) throw new BadRequestException('فترات الإتاحة كثيرة');
    for (const w of b.weekly) {
      range(w.day, 0, 6, 'اليوم');
      if (!TIME.test(w.from) || !TIME.test(w.to) || w.from >= w.to) throw new BadRequestException('فترة الإتاحة: وقت البداية قبل النهاية بصيغة 09:00');
    }
    if (b.blackouts.some((d) => !DATE.test(d))) throw new BadRequestException('الأيام المغلقة بصيغة YYYY-MM-DD');
  }

  // ---------------- الخدمات ----------------

  /** أول استخدام: تُنشأ الخدمات السبع من نموذج الموقع */
  private async ensureServices(org: string) {
    await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rw_services:${org}`]);
      if (await em.exists(ServiceRow, { where: { organizationId: org } })) return;
      await em.insert(ServiceRow, DEFAULT_SERVICES.map((s) => ({ ...s, organizationId: org })));
    });
  }

  async services(org: string, onlyPublished = false) {
    await this.ensureServices(org);
    return this.db.getRepository(ServiceRow).find({
      where: onlyPublished ? { organizationId: org, published: true } : { organizationId: org },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async service(org: string, id: string) {
    const s = await this.db.getRepository(ServiceRow).findOne({ where: { id, organizationId: org } });
    if (!s) throw new NotFoundException('الخدمة غير موجودة');
    return s;
  }

  async createService(u: OrgUser, dto: ServiceDto) {
    const repo = this.db.getRepository(ServiceRow);
    await this.ensureServices(u.organizationId);
    if (await repo.exists({ where: { organizationId: u.organizationId, slug: dto.slug } })) throw new ConflictException('المعرف مستخدم لخدمة أخرى');
    const [{ n }] = await this.db.query('SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS n FROM rw_services WHERE organization_id = $1', [u.organizationId]);
    const s = await repo.save(repo.create({ ...dto, organizationId: u.organizationId, sortOrder: n }));
    await this.audit(u, 'service', 'create', s.slug, null, snap(s));
    return s;
  }

  async updateService(u: OrgUser, id: string, dto: ServiceDto) {
    const repo = this.db.getRepository(ServiceRow);
    const s = await this.service(u.organizationId, id);
    if (dto.slug !== s.slug && (await repo.exists({ where: { organizationId: u.organizationId, slug: dto.slug } }))) {
      throw new ConflictException('المعرف مستخدم لخدمة أخرى');
    }
    const before = snap(s);
    Object.assign(s, dto);
    const saved = await repo.save(s);
    await this.audit(u, 'service', 'update', saved.slug, before, snap(saved));
    return saved;
  }

  async removeService(u: OrgUser, id: string) {
    const s = await this.service(u.organizationId, id);
    await this.db.getRepository(ServiceRow).delete({ id: s.id, organizationId: u.organizationId });
    await this.audit(u, 'service', 'delete', s.slug, snap(s), null);
    return { ok: true };
  }

  async orderServices(u: OrgUser, ids: string[]) {
    await this.db.transaction(async (em) => {
      for (const [i, id] of ids.entries()) {
        await em.update(ServiceRow, { id, organizationId: u.organizationId }, { sortOrder: i + 1 });
      }
    });
    const list = await this.services(u.organizationId);
    await this.audit(u, 'service', 'order', null, null, { order: list.map((x) => x.slug) });
    return list;
  }

  // ---------------- سجل التعديلات ----------------

  /** يسجل من عدّل ماذا ومتى، مع ما قبل التعديل وما بعده */
  async audit(u: OrgUser, area: 'content' | 'service' | 'guide', action: string, target: string | null, before: unknown, after: unknown) {
    await this.db.getRepository(ContentEvent).insert({
      organizationId: u.organizationId, area, action, target, before: (before ?? null) as never, after: (after ?? null) as never,
      userId: u.id, userName: u.fullName,
    });
  }

  /** آخر التعديلات (الأحدث أولًا) */
  history(org: string, limit = 200) {
    return this.db.getRepository(ContentEvent).find({ where: { organizationId: org }, order: { createdAt: 'DESC' }, take: limit });
  }

  // ---------------- الموقع العام ----------------

  /** كل ما يحتاجه الموقع العام في طلب واحد: المحتوى المنشور والخدمات وقائمة الأدلة وإعداد الحجز المعلن */
  async publicSite() {
    const org = await this.companyId();
    const [secs, services, guides, company] = await Promise.all([
      this.sections(org),
      this.services(org, true),
      this.db.query(
        `SELECT slug, title, summary, service_slug AS "serviceSlug", pages, (cover_key IS NOT NULL) AS "hasCover"
           FROM rw_guides WHERE organization_id = $1 AND published AND file_key IS NOT NULL ORDER BY sort_order, created_at`, [org]),
      this.db.query('SELECT name FROM organizations WHERE id = $1', [org]),
    ]);
    const content: Record<string, unknown> = {};
    for (const s of secs) {
      if (PRIVATE_KEYS.includes(s.key)) continue;
      if (s.key === 'booking') {
        const b = s.data as unknown as BookingSettings;
        content.booking = { enabled: b.enabled, slotMinutes: b.slotMinutes, title: b.title, intro: b.intro, meetingNote: b.meetingNote };
      } else content[s.key] = s.data;
    }
    return {
      company: { name: company[0]?.name ?? 'رعاية وطن' },
      content,
      services: services.map(({ id: _id, organizationId: _o, createdAt: _c, updatedAt: _u, published: _p, sortOrder: _s, ...rest }) => rest),
      guides,
    };
  }
}

/** نسخة من الصف للسجل، بلا الحقول التقنية */
export function snap<T extends object>(row: T): Record<string, unknown> {
  const { organizationId: _o, createdAt: _c, updatedAt: _u, ...rest } = row as Record<string, unknown>;
  return rest;
}
