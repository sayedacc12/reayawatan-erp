import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** ألوان الهوية: الأساسي للأزرار والعناوين، والثانوي للتدرجات، والمميز للإبراز، والداكن للخلفيات الداكنة */
export interface IdentityColors { primary: string; secondary: string; accent: string; dark: string }
/** خط النصوص وخط العناوين من قائمة الخطوط العربية المعتمدة */
export interface IdentityFonts { body: string; heading: string }
export interface IdentityValue { title: string; text: string }
export interface IdentitySocial { x: string; instagram: string; linkedin: string; youtube: string; snapchat: string; tiktok: string; facebook: string; whatsapp: string }
export interface IdentityContact { phone: string; email: string; address: string; city: string; mapUrl: string; workingHours: string; poBox: string; social: IdentitySocial }
export interface StoredImage { key: string; mime: string; v: number }

/**
 * هوية الشركة: الاسم والشعار والألوان والخطوط والرؤية والرسالة والأهداف والقيم وبيانات التواصل.
 * يديرها مدير نظام الشركة، ويستخدمها الموقع الإلكتروني وصفحة الدخول، وتُطبَّق ألوانها داخل النظام إن رغبت الشركة.
 */
@Entity('org_identity')
export class OrgIdentity {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** الاسم الظاهر (null = اسم الشركة المسجل في المنصة) */
  @Column({ name: 'display_name', type: 'varchar', length: 200, nullable: true })
  displayName!: string | null;

  @Column({ name: 'short_name', type: 'varchar', length: 60, nullable: true })
  shortName!: string | null;

  @Column({ name: 'english_name', type: 'varchar', length: 200, nullable: true })
  englishName!: string | null;

  /** العبارة التعريفية (الشعار اللفظي) */
  @Column({ type: 'varchar', length: 300, nullable: true })
  slogan!: string | null;

  /** نبذة عن الشركة */
  @Column({ type: 'text', nullable: true })
  about!: string | null;

  @Column({ type: 'text', nullable: true })
  vision!: string | null;

  @Column({ type: 'text', nullable: true })
  mission!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  goals!: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  values!: IdentityValue[];

  @Column({ type: 'jsonb', default: () => `'{}'` })
  colors!: IdentityColors;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  fonts!: IdentityFonts;

  /** الشعار الأساسي (للخلفيات الفاتحة) */
  @Column({ type: 'jsonb', nullable: true })
  logo!: StoredImage | null;

  /** نسخة الشعار للخلفيات الداكنة (اختيارية) */
  @Column({ name: 'logo_light', type: 'jsonb', nullable: true })
  logoLight!: StoredImage | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  contact!: IdentityContact;

  @Column({ name: 'license_no', type: 'varchar', length: 60, nullable: true })
  licenseNo!: string | null;

  @Column({ name: 'license_authority', type: 'varchar', length: 200, nullable: true })
  licenseAuthority!: string | null;

  @Column({ name: 'founded_on', type: 'date', nullable: true })
  foundedOn!: string | null;

  /** تطبيق ألوان الهوية وشعارها داخل النظام لموظفي الشركة */
  @Column({ name: 'apply_to_system', default: false })
  applyToSystem!: boolean;

  @Column({ name: 'updated_by_name', type: 'varchar', length: 200, nullable: true })
  updatedByName!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
