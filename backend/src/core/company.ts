import { EntityManager } from 'typeorm';
import { Organization } from './entities';

/**
 * وضع الشركة الواحدة (رعاية وطن): النظام يخدم منشأة واحدة فقط معرّفها COMPANY_SLUG.
 * - لا تسجيل جمعيات ولا صفحة تعريفية للمنصة، ومدير المنشأة هو المسؤول الأعلى مباشرة.
 * - الدخول بلا رابط منشأة يعني منشأة الشركة.
 * - الموقع الإلكتروني العام يعرض بيانات هذه المنشأة.
 * بدون COMPANY_SLUG يعمل الكود كما في سنابل (تستخدمه الاختبارات التي تنشئ أكثر من منشأة لفحص العزل).
 */
export function companySlug(): string | null {
  const s = process.env.COMPANY_SLUG?.trim().toLowerCase();
  return s ? s : null;
}

export const isSingleCompany = () => companySlug() !== null;

/** منشأة الشركة، أو null إن لم تكن مضبوطة أو لم تُنشأ بعد */
export async function findCompany(em: EntityManager): Promise<Organization | null> {
  const slug = companySlug();
  return slug ? em.findOne(Organization, { where: { slug } }) : null;
}
