import { ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { findCompany } from '../../core/company';
import { User } from '../../core/entities';
import { DocumentsService } from '../quality/documents.service';
import { QmsCore } from '../quality/quality-core.service';
import { DocumentDto, ProcessMapDto } from '../quality/quality.dto';
import { QUALITY_PERMISSIONS } from '../quality/quality.manifest';
import { StarterResult } from './starter.entity';

/** ملف حزمة في assets/quality-pack (يبنيه tools/quality-pack/build.py) */
export interface QualityPackFile {
  key: string;
  label: string;
  documents: DocumentDto[];
  maps: (ProcessMapDto & { docCode: string })[];
}

export const QUALITY_PACK_PREFIX = 'quality.';

/**
 * إجراءات الجودة الجاهزة لشركة رعاية وطن (قرار المالك 2026-11-23): كل الإجراءات والأدلة والنماذج المتوفرة تُدرج في
 * «سجل الوثائق المضبوطة» بحالة «مسودة» Rev.00 ببياناتها الكاملة، مع خرائط إجراءاتها، لتُراجع وتُعتمد في مسار الاعتماد
 * المعتاد (مراجعة الجودة ثم الاعتماد). لا يُعتمد شيء هنا.
 *
 * - المصدر: ملفات JSON في assets/quality-pack، ملف لكل مجموعة (نظام الجودة، نماذج المجلس، دليل كل نظام).
 * - كل ملف يُدرج مرة واحدة (organization_starters = quality.<key>)، فإن حذفت الشركة مسودة بعد اكتمال ملفها لا تعود.
 *   ملف جديد (دليل نظام آخر) يُدرج مع التحديث التالي تلقائيًا.
 * - داخل الملف: الوثيقة أو الخريطة الموجودة بالكود نفسه تُتجاوز ولا تُعدَّل، فلا يتكرر شيء إن انقطع تشغيل سابق.
 * - عبر خدمات وحدة الجودة نفسها وبنفس تحقق الطلبات (DocumentDto وProcessMapDto)، باسم مدير نظام الشركة.
 * - رموز الأنظمة الناقصة في الترميز (FIN وPLN ...) تُضاف إلى إعدادات الجودة دون حذف أو تعديل الموجود.
 */
@Injectable()
export class CompanyQualityService implements OnApplicationBootstrap {
  private readonly logger = new Logger('CompanyQuality');

  constructor(private readonly db: DataSource, private readonly core: QmsCore, private readonly docs: DocumentsService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.QUALITY_PACK === 'off') return;
    setTimeout(() => { this.run().catch((e) => this.logger.error(`Quality pack failed: ${(e as Error).message}`, (e as Error).stack)); }, 8000).unref();
  }

  private dir() {
    return process.env.QUALITY_PACK_DIR ?? join(process.cwd(), 'assets', 'quality-pack');
  }

  async files(): Promise<QualityPackFile[]> {
    const names = (await readdir(this.dir())).filter((n) => /^\d{2}-[a-z0-9-]+\.json$/.test(n)).sort();
    return Promise.all(names.map(async (n) => JSON.parse(await readFile(join(this.dir(), n), 'utf8')) as QualityPackFile));
  }

  private async departments(): Promise<{ code: string; name: string }[]> {
    return JSON.parse(await readFile(join(this.dir(), 'departments.json'), 'utf8'));
  }

  private async actor(orgId: string, slug: string): Promise<OrgUser | null> {
    const admin = await this.db.getRepository(User).findOne({ where: { organizationId: orgId, isSuperadmin: true, isActive: true }, order: { createdAt: 'ASC' } });
    if (!admin) return null;
    return {
      id: admin.id, organizationId: orgId, organizationName: null, organizationSlug: slug, email: admin.email, username: null,
      fullName: admin.fullName, isSuperadmin: true, isPlatformAdmin: false, permissions: Object.values(QUALITY_PERMISSIONS),
    };
  }

  /** نفس تحقق الطلبات القادمة من الشاشة، فلا يُدرج ما لا يقبله النموذج */
  private async check<T extends object>(cls: new () => T, plain: unknown, what: string): Promise<T> {
    const dto = plainToInstance(cls, plain);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) throw new Error(`${what}: ${errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ') || 'nested'}`).join('; ')}`);
    return dto;
  }

  /** يضيف رموز الأنظمة الناقصة إلى ترميز الجودة، ويعيد عدد ما أضيف */
  private async ensureDepartments(a: OrgUser) {
    const s = await this.core.settings(a.organizationId);
    const have = new Set(s.departments.map((d) => d.code));
    const missing = (await this.departments()).filter((d) => !have.has(d.code));
    if (!missing.length) return 0;
    await this.core.saveSettings(a, {
      prefixes: this.core.prefixes(s), departments: [...s.departments, ...missing], seqDigits: s.seqDigits,
      reviewMonths: s.reviewMonths, complaintDays: s.complaintDays, ncrDays: s.ncrDays,
    });
    return missing.length;
  }

  /** تشغيل الحزمة لمنشأة الشركة. يعيد null إن لم تُشغَّل (لا شركة أو لا مدير) */
  async run(): Promise<StarterResult[] | null> {
    const company = await findCompany(this.db.manager);
    if (!company) return null;
    const a = await this.actor(company.id, company.slug);
    if (!a) return null;
    const org = company.id;
    const packs = await this.files();
    const results: StarterResult[] = [];
    let deptsDone = false;
    for (const pack of packs) {
      const code = `${QUALITY_PACK_PREFIX}${pack.key}`.slice(0, 40);
      // حجز متروك من تشغيل انقطع يُعاد بعد 20 دقيقة
      await this.db.query(
        `DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applying' AND applied_at < now() - interval '20 minutes'`,
        [org, code]);
      const reserved = await this.db.query(
        `INSERT INTO organization_starters (organization_id, module_code, status, applied_by, applied_by_id, results)
         VALUES ($1, $2, 'applying', $3, $4, '[]'::jsonb) ON CONFLICT DO NOTHING RETURNING applied_at::text AS applied_at`,
        [org, code, a.fullName, a.id]);
      if (!reserved.length) continue;
      const mine = reserved[0].applied_at as string;
      try {
        if (!deptsDone) {
          const n = await this.ensureDepartments(a);
          deptsDone = true;
          if (n) results.push({ key: 'departments', label: 'رموز الأنظمة في ترميز الجودة', added: n });
        }
        const r = await this.apply(a, pack);
        results.push(r);
        await this.db.query(
          `UPDATE organization_starters SET status = 'applied', applied_at = now(), results = $3::jsonb WHERE organization_id = $1 AND module_code = $2 AND applied_at = $4::timestamptz`,
          [org, code, JSON.stringify([r]), mine]);
      } catch (e) {
        this.logger.error(`Quality pack "${pack.key}" stopped: ${(e as Error).message}`, (e as Error).stack);
        await this.db.query(
          `DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applying' AND applied_at = $3::timestamptz`,
          [org, code, mine]).catch(() => undefined);
        throw e;
      }
    }
    if (results.length) this.logger.log(`Quality pack applied for org ${org}: ${results.map((r) => `${r.key}=${r.added}`).join(', ')}`);
    return results;
  }

  private async apply(a: OrgUser, pack: QualityPackFile): Promise<StarterResult> {
    const org = a.organizationId;
    let docs = 0;
    let maps = 0;
    let skipped = 0;
    for (const raw of pack.documents) {
      const dto = await this.check(DocumentDto, raw, `document ${raw.code}`);
      try {
        await this.core.ensureFreeCode(org, dto.code!);
      } catch (e) {
        if (e instanceof ConflictException) { skipped++; continue; }
        throw e;
      }
      await this.docs.create(a, dto);
      docs++;
    }
    for (const { docCode, ...raw } of pack.maps) {
      const found = await this.db.query(
        `SELECT (SELECT id FROM quality_documents WHERE organization_id = $1 AND code = $2) AS doc,
                EXISTS (SELECT 1 FROM quality_process_maps WHERE organization_id = $1 AND code = $3) AS map`,
        [org, docCode, String(raw.code).toUpperCase()]);
      if (found[0].map) { skipped++; continue; }
      const dto = await this.check(ProcessMapDto, { ...raw, documentId: found[0].doc ?? null }, `map ${raw.code}`);
      await this.docs.saveMap(a, dto);
      maps++;
    }
    const parts = [`${docs} وثيقة مسودة`, `${maps} خريطة إجراء`, ...(skipped ? [`${skipped} موجودة مسبقًا لم تُعدَّل`] : [])];
    return { key: pack.key, label: pack.label, added: docs + maps, note: parts.join('، ') };
  }
}
