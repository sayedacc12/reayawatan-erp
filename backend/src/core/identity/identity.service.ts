import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../auth/decorators';
import { Organization } from '../entities';
import { FileStore } from '../files/file-store.service';
import { accessProblem } from '../organizations/org-access';
import { IDENTITY_FONTS, IdentityDto } from './identity.dto';
import { IdentityColors, IdentityContact, IdentityFonts, OrgIdentity, StoredImage } from './identity.entity';

export const DEFAULT_COLORS: IdentityColors = { primary: '#0f766e', secondary: '#14b8a6', accent: '#e8b04b', dark: '#0b2a2e' };
export const DEFAULT_FONTS: IdentityFonts = { body: 'IBM Plex Sans Arabic', heading: 'IBM Plex Sans Arabic' };
const EMPTY_SOCIAL = { x: '', instagram: '', linkedin: '', youtube: '', snapchat: '', tiktok: '', facebook: '', whatsapp: '' };
const EMPTY_CONTACT: IdentityContact = { phone: '', email: '', address: '', city: '', mapUrl: '', workingHours: '', poBox: '', social: EMPTY_SOCIAL };
const MAX_LOGO = 2 * 1024 * 1024;
export type LogoKind = 'logo' | 'logoLight';
const clean = (s: string | null | undefined) => (s ?? '').trim() || null;
const https = (s: string | undefined) => {
  const v = (s ?? '').trim();
  if (v && !/^https:\/\/[^\s"'<>]+$/.test(v)) throw new BadRequestException(`الرابط «${v.slice(0, 60)}» يجب أن يبدأ بـ https://`);
  return v;
};

/** هوية الجمعية: تُقرأ داخل النظام وفي الصفحات العامة، ويعدّلها مدير نظام الجمعية */
@Injectable()
export class IdentityService {
  constructor(private readonly db: DataSource, private readonly files: FileStore) {}

  private repo() {
    return this.db.getRepository(OrgIdentity);
  }

  async row(org: string) {
    const found = await this.repo().findOne({ where: { organizationId: org } });
    if (found) return found;
    await this.repo().createQueryBuilder().insert().values({ organizationId: org, colors: DEFAULT_COLORS, fonts: DEFAULT_FONTS, contact: EMPTY_CONTACT }).orIgnore().execute();
    return this.repo().findOneOrFail({ where: { organizationId: org } });
  }

  /** الهوية كاملة بصيغة الواجهة، مع اسم الجمعية المسجل وروابط الشعار */
  async view(org: string) {
    const [o] = await this.db.query('SELECT name, slug FROM organizations WHERE id = $1', [org]);
    const r = await this.row(org);
    const logoUrl = (k: LogoKind) => (r[k] ? `/api/public/identity/${o.slug}/${k}?v=${r[k]!.v}` : null);
    return {
      organizationName: o.name as string, slug: o.slug as string,
      name: r.displayName || o.name, displayName: r.displayName, shortName: r.shortName, englishName: r.englishName, slogan: r.slogan,
      about: r.about, vision: r.vision, mission: r.mission, goals: r.goals ?? [], values: r.values ?? [],
      colors: { ...DEFAULT_COLORS, ...r.colors }, fonts: { ...DEFAULT_FONTS, ...r.fonts },
      contact: { ...EMPTY_CONTACT, ...r.contact, social: { ...EMPTY_SOCIAL, ...(r.contact?.social ?? {}) } },
      logoUrl: logoUrl('logo'), logoLightUrl: logoUrl('logoLight'),
      licenseNo: r.licenseNo, licenseAuthority: r.licenseAuthority, foundedOn: r.foundedOn, applyToSystem: r.applyToSystem,
      updatedByName: r.updatedByName, updatedAt: r.updatedAt, fontsList: IDENTITY_FONTS,
    };
  }

  async save(actor: OrgUser, dto: IdentityDto) {
    const org = actor.organizationId;
    await this.row(org);
    const goals = dto.goals.map((g) => g.trim()).filter(Boolean);
    const values = dto.values.map((v) => ({ title: v.title.trim(), text: v.text.trim() })).filter((v) => v.title);
    const c = dto.contact ?? {};
    const s = c.social ?? {};
    const email = (c.email ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('البريد الإلكتروني غير صحيح');
    const contact: IdentityContact = {
      phone: (c.phone ?? '').trim(), email, address: (c.address ?? '').trim(), city: (c.city ?? '').trim(), mapUrl: https(c.mapUrl),
      workingHours: (c.workingHours ?? '').trim(), poBox: (c.poBox ?? '').trim(),
      social: {
        x: https(s.x), instagram: https(s.instagram), linkedin: https(s.linkedin), youtube: https(s.youtube), snapchat: https(s.snapchat),
        tiktok: https(s.tiktok), facebook: https(s.facebook), whatsapp: (s.whatsapp ?? '').replace(/[^\d+]/g, ''),
      },
    };
    await this.repo().update({ organizationId: org }, {
      displayName: clean(dto.displayName), shortName: clean(dto.shortName), englishName: clean(dto.englishName), slogan: clean(dto.slogan),
      about: clean(dto.about), vision: clean(dto.vision), mission: clean(dto.mission), goals, values,
      colors: { primary: dto.colors.primary.toLowerCase(), secondary: dto.colors.secondary.toLowerCase(), accent: dto.colors.accent.toLowerCase(), dark: dto.colors.dark.toLowerCase() },
      fonts: { body: dto.fonts.body, heading: dto.fonts.heading }, contact,
      licenseNo: clean(dto.licenseNo), licenseAuthority: clean(dto.licenseAuthority), foundedOn: dto.foundedOn || null,
      applyToSystem: dto.applyToSystem, updatedByName: actor.fullName,
    });
    return this.view(org);
  }

  async uploadLogo(actor: OrgUser, kind: LogoKind, file: Express.Multer.File | undefined) {
    if (file && file.size > MAX_LOGO) throw new BadRequestException('حجم الشعار أكبر من 2 ميجابايت');
    if (file?.buffer?.subarray(0, 4).toString('latin1') === '%PDF') throw new BadRequestException('الشعار يجب أن يكون صورة PNG أو JPG أو WEBP');
    const org = actor.organizationId;
    const r = await this.row(org);
    const saved = await this.files.save(`identity/${org}`, file, 'الشعار');
    const old = r[kind];
    const img: StoredImage = { key: saved.key, mime: saved.mime, v: (old?.v ?? 0) + 1 };
    await this.repo().update({ organizationId: org }, { [kind]: img, updatedByName: actor.fullName });
    if (old) await this.files.remove(old.key).catch(() => undefined);
    return this.view(org);
  }

  async removeLogo(actor: OrgUser, kind: LogoKind) {
    const org = actor.organizationId;
    const r = await this.row(org);
    if (r[kind]) {
      await this.repo().update({ organizationId: org }, { [kind]: null, updatedByName: actor.fullName });
      await this.files.remove(r[kind]!.key).catch(() => undefined);
    }
    return this.view(org);
  }

  /** الجمعية من معرفها في الرابط العام، مع منع الجمعية الموقوفة أو المنتهي اشتراكها */
  async organization(slug: string) {
    const org = await this.db.getRepository(Organization).findOne({ where: { slug: String(slug).toLowerCase() } });
    if (!org) throw new NotFoundException('الجمعية غير موجودة');
    if (accessProblem(org)) throw new NotFoundException('صفحة الجمعية غير متاحة حاليًا');
    return org;
  }

  /** الهوية للصفحات العامة (الموقع وصفحة الدخول) */
  async publicView(slug: string) {
    const org = await this.organization(slug);
    const v = await this.view(org.id);
    const { applyToSystem, updatedByName, updatedAt, fontsList, organizationName, ...rest } = v;
    void applyToSystem; void updatedByName; void updatedAt; void fontsList; void organizationName;
    return rest;
  }

  async logoFile(slug: string, kind: LogoKind) {
    const [o] = await this.db.query('SELECT id FROM organizations WHERE slug = $1', [String(slug).toLowerCase()]);
    if (!o) throw new NotFoundException('الشعار غير موجود');
    const r = await this.repo().findOne({ where: { organizationId: o.id } });
    const img = r?.[kind];
    if (!img) throw new NotFoundException('الشعار غير موجود');
    return { stream: this.files.open(img.key), mime: img.mime };
  }
}
