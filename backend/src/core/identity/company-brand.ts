import { Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { companySlug } from '../company';
import { FileStore } from '../files/file-store.service';
import { OrgIdentity, StoredImage } from './identity.entity';

/**
 * الهوية الافتراضية لرعاية وطن (من دليل الهوية والملف التعريفي ومستندات التأسيس).
 * تُكتب مرة واحدة عند التشغيل، ولا تُكتب إطلاقًا بعد أن يحفظ أحد الهوية من شاشة «هوية الشركة»
 * (updated_by_name يصبح غير فارغ)، فلا يُستبدل أي تعديل يدوي.
 */
export const COMPANY_BRAND = {
  slug: 'reayawatan',
  displayName: 'شركة رعاية وطن للاستثمار',
  shortName: 'رعاية وطن',
  englishName: 'National Care',
  slogan: 'نصنع الأثر بالقيمة المضافة',
  about: 'شركة سعودية غير ربحية مملوكة بالكامل للجمعية الخيرية الصحية لرعاية المرضى «عناية». تخدم القطاع غير الربحي عمومًا والقطاع الصحي خصوصًا، وتعود عوائدها لرسالة الجمعية.',
  vision: 'الريادة في الاستثمار غير الربحي المستدام لخدمة الإنسان والمجتمع.',
  mission: 'تعظيم الأثر المجتمعي لجمعية عناية من خلال استثمار مواردها وأصولها بكفاءة وشفافية، وتوجيه العوائد لدعم التنمية الصحية المستدامة وفق أفضل ممارسات الحوكمة والاستثمار المسؤول.',
  goals: [
    'بناء مصادر دخل ذاتية مستدامة تدعم رسالة جمعية عناية',
    'رفع كفاءة القطاع غير الربحي في التخطيط والحوكمة والتمويل والتقنية',
    'قياس الأثر المجتمعي والإفصاح عنه بتقارير دورية واضحة',
    'تطوير المشاريع والتدريب في القطاع الصحي',
  ],
  values: [
    { title: 'الشفافية', text: 'نفصح عن أدائنا وعوائدنا بتقارير دورية واضحة، ونعامل بيانات شركائنا وأموالهم كأمانة.' },
    { title: 'الاستدامة', text: 'نبني مصادر دخل ذاتية طويلة الأمد تضمن استمرار الخدمات الصحية والاجتماعية.' },
    { title: 'الابتكار', text: 'نطوّر نماذج ومنتجات جديدة في الاستثمار والتدريب والاستشارات والتقنية الصحية.' },
    { title: 'الكفاءة', text: 'نستثمر الموارد والأصول بأعلى عائد ممكن، ونرفع الكفاءة التشغيلية في كل ما ندير.' },
  ],
  colors: { primary: '#164e38', secondary: '#2c3e33', accent: '#c7a27a', dark: '#0f2e22' },
  fonts: { body: 'IBM Plex Sans Arabic', heading: 'Reem Kufi' },
  contact: {
    phone: '', email: 'info@reayawatan.com', address: 'حي الرحمانية، شارع الوليد التميمي، الرمز البريدي 12341', city: 'الرياض', mapUrl: '', workingHours: '', poBox: '',
    social: { x: '', instagram: '', linkedin: '', youtube: '', snapchat: '', tiktok: '', facebook: '', whatsapp: '' },
  },
  taxNumber: '314466205600003',
  licenseNo: '7052873945',
  licenseAuthority: 'وزارة التجارة (السجل التجاري)',
  foundedOn: '2025-12-08',
  logos: { logo: 'logo.png', logoLight: 'logo-light.png' } as const,
};

const BRAND_DIR = process.env.BRAND_DIR ?? join(process.cwd(), 'assets', 'brand');

/** يملأ هوية رعاية وطن إن لم يحفظها أحد بعد. آمن للتكرار، ويتجاهل أي منشأة غير رعاية وطن. */
export async function seedCompanyBrand(db: DataSource, files: FileStore, org: { id: string; slug: string }, logger = new Logger('Brand')) {
  if (org.slug !== COMPANY_BRAND.slug || companySlug() !== COMPANY_BRAND.slug) return;
  const repo = db.getRepository(OrgIdentity);
  const b = COMPANY_BRAND;
  await repo.createQueryBuilder().insert().values({ organizationId: org.id, colors: b.colors, fonts: b.fonts, contact: b.contact }).orIgnore().execute();
  const row = await repo.findOneOrFail({ where: { organizationId: org.id } });
  if (row.updatedByName) return;

  const logos: Partial<Record<'logo' | 'logoLight', StoredImage>> = {};
  for (const kind of ['logo', 'logoLight'] as const) {
    if (row[kind]) continue;
    try {
      const buffer = await readFile(join(BRAND_DIR, b.logos[kind]));
      const saved = await files.save(`identity/${org.id}`, { buffer, size: buffer.length, originalname: b.logos[kind] } as Express.Multer.File, 'الشعار');
      logos[kind] = { key: saved.key, mime: saved.mime, v: 1 };
    } catch (e) {
      logger.warn(`Brand logo ${kind} not stored: ${(e as Error).message}`);
    }
  }

  // الشرط updated_by_name IS NULL في نفس الجملة، فلا يُكتب فوق حفظ يدوي حدث بين القراءة والكتابة
  const res = await db.transaction(async (em) => {
    const r = await em.getRepository(OrgIdentity).createQueryBuilder().update(OrgIdentity).set({
      displayName: b.displayName, shortName: b.shortName, englishName: b.englishName, slogan: b.slogan,
      about: b.about, vision: b.vision, mission: b.mission, goals: b.goals, values: b.values,
      colors: b.colors, fonts: b.fonts, contact: b.contact,
      licenseNo: b.licenseNo, licenseAuthority: b.licenseAuthority, foundedOn: b.foundedOn,
      applyToSystem: true, updatedByName: 'إعداد الهوية الافتراضية', ...logos,
    }).where('organization_id = :org AND updated_by_name IS NULL', { org: org.id }).execute();
    // الرقم الضريبي (يظهر في الفواتير) مرة واحدة فقط مع أول تعبئة للهوية، وإن كان فارغًا؛ فلا يُعاد إن حذفه المستخدم لاحقًا
    if (r.affected) await em.query('UPDATE organizations SET tax_number = $1 WHERE id = $2 AND tax_number IS NULL', [b.taxNumber, org.id]);
    return r;
  }).catch((e) => { logger.warn(`Company identity defaults not saved: ${(e as Error).message}`); return { affected: 0 }; });
  if (!res.affected) {
    for (const img of Object.values(logos)) await files.remove(img!.key).catch(() => undefined);
    return;
  }
  logger.log('Company identity filled with the رعاية وطن defaults');
}
