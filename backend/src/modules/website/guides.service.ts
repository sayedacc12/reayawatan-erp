import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { publicOrigin } from '../../core/mail/mail-templates';
import { Guide, GuideDownload, LeadEvent } from './entities/website.entity';
import { tokenHash } from './booking.service';
import { LeadsService } from './leads.service';
import { GuideDto, GuideRequestDto } from './website.dto';

/** صلاحية رابط التنزيل وعدد مرات استخدامه */
const LINK_HOURS = 72;
const LINK_MAX_USES = 5;

@Injectable()
export class GuidesService {
  constructor(private readonly db: DataSource, private readonly files: FileStore, private readonly leads: LeadsService) {}

  list(u: OrgUser) {
    return this.db.getRepository(Guide).find({ where: { organizationId: u.organizationId }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  async get(org: string, id: string) {
    const g = await this.db.getRepository(Guide).findOne({ where: { id, organizationId: org } });
    if (!g) throw new NotFoundException('الدليل غير موجود');
    return g;
  }

  async create(u: OrgUser, dto: GuideDto) {
    const repo = this.db.getRepository(Guide);
    if (await repo.exists({ where: { organizationId: u.organizationId, slug: dto.slug } })) throw new ConflictException('المعرف مستخدم لدليل آخر');
    if (dto.published) throw new BadRequestException('ارفعوا ملف الدليل أولًا ثم انشروه');
    const [{ n }] = await this.db.query('SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS n FROM rw_guides WHERE organization_id = $1', [u.organizationId]);
    return repo.save(repo.create({ ...dto, serviceSlug: dto.serviceSlug || null, pages: dto.pages ?? null, organizationId: u.organizationId, sortOrder: n }));
  }

  async update(u: OrgUser, id: string, dto: GuideDto) {
    const repo = this.db.getRepository(Guide);
    const g = await this.get(u.organizationId, id);
    if (dto.slug !== g.slug && (await repo.exists({ where: { organizationId: u.organizationId, slug: dto.slug } }))) throw new ConflictException('المعرف مستخدم لدليل آخر');
    if (dto.published && !g.fileKey) throw new BadRequestException('ارفعوا ملف الدليل (PDF) قبل النشر');
    Object.assign(g, { ...dto, serviceSlug: dto.serviceSlug || null, pages: dto.pages ?? null });
    return repo.save(g);
  }

  async upload(u: OrgUser, id: string, kind: 'file' | 'cover', file: Express.Multer.File | undefined) {
    const g = await this.get(u.organizationId, id);
    const saved = await this.files.save(`website/${u.organizationId}`, file, kind === 'file' ? 'ملف الدليل' : 'صورة الغلاف');
    if (kind === 'file') {
      if (saved.mime !== 'application/pdf') { await this.files.remove(saved.key); throw new BadRequestException('ملف الدليل بصيغة PDF فقط'); }
      const old = g.fileKey;
      Object.assign(g, { fileKey: saved.key, fileName: saved.name, fileMime: saved.mime, fileSize: file!.size });
      await this.db.getRepository(Guide).save(g);
      if (old) await this.files.remove(old);
    } else {
      if (saved.mime === 'application/pdf') { await this.files.remove(saved.key); throw new BadRequestException('الغلاف صورة (PNG أو JPG أو WEBP)'); }
      const old = g.coverKey;
      Object.assign(g, { coverKey: saved.key, coverMime: saved.mime });
      await this.db.getRepository(Guide).save(g);
      if (old) await this.files.remove(old);
    }
    return g;
  }

  async remove(u: OrgUser, id: string) {
    const g = await this.get(u.organizationId, id);
    // الدليل الذي نُزِّل يبقى سجله مع العملاء المحتملين: يُخفى بدل الحذف
    if (g.downloads > 0) {
      g.published = false;
      await this.db.getRepository(Guide).save(g);
      return { ok: true, hidden: true };
    }
    await this.db.getRepository(Guide).delete({ id: g.id, organizationId: u.organizationId });
    if (g.fileKey) await this.files.remove(g.fileKey);
    if (g.coverKey) await this.files.remove(g.coverKey);
    return { ok: true };
  }

  async order(u: OrgUser, ids: string[]) {
    await this.db.transaction(async (em) => {
      for (const [i, id] of ids.entries()) await em.update(Guide, { id, organizationId: u.organizationId }, { sortOrder: i + 1 });
    });
    return this.list(u);
  }

  /** معاينة ملف الدليل للموظفين */
  async staffFile(u: OrgUser, id: string) {
    const g = await this.get(u.organizationId, id);
    if (!g.fileKey) throw new NotFoundException('لم يُرفع ملف للدليل');
    return { stream: this.files.open(g.fileKey), mime: g.fileMime ?? 'application/pdf', name: g.fileName ?? `${g.slug}.pdf` };
  }

  // ---------------- الموقع العام ----------------

  private async published(org: string, slug: string) {
    const g = await this.db.getRepository(Guide).findOne({ where: { organizationId: org, slug, published: true } });
    if (!g || !g.fileKey) throw new NotFoundException('الدليل غير متاح');
    return g;
  }

  async cover(org: string, slug: string) {
    const g = await this.published(org, slug);
    if (!g.coverKey) throw new NotFoundException('لا يوجد غلاف');
    return { stream: this.files.open(g.coverKey), mime: g.coverMime ?? 'image/png' };
  }

  /** الزائر يدخل بريده: يُسجل عميلًا محتملًا ويحصل على رابط تنزيل مؤقت (ويصله على بريده أيضًا) */
  async request(org: string, slug: string, dto: GuideRequestDto) {
    const g = await this.published(org, slug);
    const token = randomBytes(32).toString('base64url');
    const lead = await this.db.transaction(async (em) => {
      const lead = await this.leads.create(em, org, 'guide', dto, { serviceSlug: g.serviceSlug, result: { guide: g.slug, title: g.title } });
      await em.insert(GuideDownload, { organizationId: org, guideId: g.id, leadId: lead.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + LINK_HOURS * 3600000) });
      await em.save(LeadEvent, { organizationId: org, leadId: lead.id, kind: 'guide', text: `طلب دليل: ${g.title}`, userName: 'الموقع الإلكتروني' });
      return lead;
    });
    await this.leads.notifyTeam(org, lead, [{ label: 'الدليل', value: g.title }]);
    const origin = publicOrigin();
    const url = `/api/public/web/guides/download/${token}`;
    await this.leads.confirmVisitor(org, lead, `دليلكم: ${g.title}`, ['شكرًا لاهتمامكم. رابط التنزيل صالح لمدة ثلاثة أيام.'], [],
      origin ? { label: 'تنزيل الدليل', url: `${origin}${url}` } : undefined);
    return { ok: true, downloadUrl: url };
  }

  async download(org: string, token: string) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new NotFoundException('الرابط غير صحيح أو انتهت صلاحيته');
    const row = await this.db.transaction(async (em) => {
      // UPDATE ... RETURNING في TypeORM يعيد [الصفوف، العدد]
      const res = await em.query(
        `UPDATE rw_guide_downloads SET used_count = used_count + 1
          WHERE organization_id = $1 AND token_hash = $2 AND expires_at > now() AND used_count < $3
          RETURNING guide_id, used_count`, [org, tokenHash(token), LINK_MAX_USES]);
      const rows = (Array.isArray(res[0]) ? res[0] : res) as { guide_id: string; used_count: number }[];
      const hit = rows[0];
      if (!hit) return null;
      if (hit.used_count === 1) await em.query('UPDATE rw_guides SET downloads = downloads + 1 WHERE organization_id = $1 AND id = $2', [org, hit.guide_id]);
      return hit as { guide_id: string };
    });
    if (!row) throw new NotFoundException('الرابط غير صحيح أو انتهت صلاحيته');
    const g = await this.db.getRepository(Guide).findOne({ where: { id: row.guide_id, organizationId: org } });
    if (!g?.fileKey) throw new NotFoundException('الدليل غير متاح');
    return { stream: this.files.open(g.fileKey), mime: 'application/pdf', name: g.fileName ?? `${g.slug}.pdf` };
  }
}
