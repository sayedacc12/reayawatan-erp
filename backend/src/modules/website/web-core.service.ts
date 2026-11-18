import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { IdentityService } from '../../core/identity/identity.service';
import { WebActivity, WebMedia, WebSettings } from './entities/website.entity';
import {
  DEFAULT_ABOUT, DEFAULT_ACCOUNTING, DEFAULT_GOVERNANCE, DEFAULT_HOME, DEFAULT_PAYMENT, DEFAULT_SECTIONS, DEFAULT_SEO, DEFAULT_STORE,
} from './website-defaults';

/** اليوم بتوقيت الرياض */
export const webToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export const randomToken = (bytes = 16) => randomBytes(bytes).toString('hex');
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGE = 5 * 1024 * 1024;

/** الإعدادات والصور وسجل النشاط: مشتركة بين خدمات الموقع */
@Injectable()
export class WebCore {
  constructor(private readonly db: DataSource, private readonly files: FileStore, readonly identity: IdentityService) {}

  /** إعدادات الموقع، وتُعبأ بالقيم الافتراضية عند أول استخدام */
  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(WebSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    if (!s.initialized) {
      const init = {
        sections: DEFAULT_SECTIONS, home: DEFAULT_HOME, about: DEFAULT_ABOUT, governance: DEFAULT_GOVERNANCE, seo: DEFAULT_SEO,
        store: DEFAULT_STORE, payment: DEFAULT_PAYMENT, accounting: DEFAULT_ACCOUNTING, previewKey: randomToken(10), initialized: true,
      };
      Object.assign(s, init);
      await repo.update({ organizationId: org, initialized: false }, init);
    }
    s.sections = { ...DEFAULT_SECTIONS, ...s.sections };
    s.home = { ...DEFAULT_HOME, ...s.home, announcement: { ...DEFAULT_HOME.announcement, ...(s.home?.announcement ?? {}) } };
    s.about = { ...DEFAULT_ABOUT, ...s.about };
    s.governance = { ...DEFAULT_GOVERNANCE, ...s.governance };
    s.seo = { ...DEFAULT_SEO, ...s.seo };
    s.store = { ...DEFAULT_STORE, ...s.store };
    s.payment = { ...DEFAULT_PAYMENT, ...s.payment };
    s.accounting = { ...DEFAULT_ACCOUNTING, ...s.accounting };
    return s;
  }

  async log(org: string, byName: string, action: string, target: string | null = null, em: EntityManager = this.db.manager) {
    await em.getRepository(WebActivity).insert({ organizationId: org, byName, action, target: target?.slice(0, 300) ?? null });
  }

  async activity(org: string, limit = 300) {
    return this.db.getRepository(WebActivity).find({ where: { organizationId: org }, order: { at: 'DESC' }, take: Math.min(limit, 1000) });
  }

  // ---------------- مكتبة الصور ----------------

  mediaUrl(slug: string, id: string | null | undefined) {
    return id ? `/api/public/website/${slug}/media/${id}` : null;
  }

  async upload(actor: OrgUser, file: Express.Multer.File | undefined) {
    if (file && file.size > MAX_IMAGE) throw new BadRequestException('حجم الصورة أكبر من 5 ميجابايت');
    if (file?.buffer?.subarray(0, 4).toString('latin1') === '%PDF') throw new BadRequestException('ارفع صورة (JPG أو PNG أو WEBP)، والملفات PDF مكانها أرشيف المعرفة');
    const saved = await this.files.save(`website/${actor.organizationId}`, file, 'الصورة');
    const m = await this.db.getRepository(WebMedia).save({
      organizationId: actor.organizationId, fileKey: saved.key, mime: saved.mime, name: saved.name, size: file!.size, createdByName: actor.fullName,
    });
    await this.log(actor.organizationId, actor.fullName, 'رفع صورة', saved.name);
    return { id: m.id, name: m.name, url: this.mediaUrl(actor.organizationSlug ?? '', m.id), size: m.size, createdAt: m.createdAt };
  }

  async media(actor: OrgUser) {
    const rows = await this.db.getRepository(WebMedia).find({ where: { organizationId: actor.organizationId }, order: { createdAt: 'DESC' }, take: 500 });
    return rows.map((m) => ({ id: m.id, name: m.name, url: this.mediaUrl(actor.organizationSlug ?? '', m.id), size: m.size, createdByName: m.createdByName, createdAt: m.createdAt }));
  }

  /** حذف صورة غير مستخدمة في أي محتوى */
  async removeMedia(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    if (!UUID.test(id)) throw new NotFoundException('الصورة غير موجودة');
    const m = await this.db.getRepository(WebMedia).findOne({ where: { id, organizationId: org } });
    if (!m) throw new NotFoundException('الصورة غير موجودة');
    const [use] = await this.db.query(
      `SELECT 'خبر' AS kind FROM web_news WHERE organization_id = $1 AND image_id = $2
       UNION ALL SELECT 'برنامج' FROM web_programs WHERE organization_id = $1 AND image_id = $2
       UNION ALL SELECT 'صفحة' FROM web_settings WHERE organization_id = $1 AND (home::text || about::text || governance::text || partners::text) LIKE '%' || $2::text || '%'
       LIMIT 1`, [org, id]);
    if (use) throw new BadRequestException(`الصورة مستخدمة في ${use.kind}، أزلها منه أولًا`);
    await this.db.getRepository(WebMedia).delete({ id });
    await this.files.remove(m.fileKey).catch(() => undefined);
    await this.log(org, actor.fullName, 'حذف صورة', m.name);
    return { ok: true };
  }

  async assertMedia(org: string, id: string | null | undefined, em: EntityManager = this.db.manager) {
    if (!id) return null;
    if (!UUID.test(id)) throw new BadRequestException('الصورة غير موجودة');
    const [m] = await em.query('SELECT id FROM web_media WHERE id = $1 AND organization_id = $2', [id, org]);
    if (!m) throw new BadRequestException('الصورة غير موجودة في مكتبة الصور');
    return id;
  }

  async mediaFile(org: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('الصورة غير موجودة');
    const m = await this.db.getRepository(WebMedia).findOne({ where: { id, organizationId: org } });
    if (!m) throw new NotFoundException('الصورة غير موجودة');
    return { stream: this.files.open(m.fileKey), mime: m.mime };
  }
}
