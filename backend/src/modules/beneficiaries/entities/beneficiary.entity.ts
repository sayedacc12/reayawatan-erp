import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../../../core/entities';
import type { CaseStatus, Category, Gender, HousingType, MaritalStatus, Residency } from '../constants';
import { AidDisbursement } from './aid-disbursement.entity';
import { BeneficiaryDocument } from './beneficiary-document.entity';
import { CaseResearch } from './case-research.entity';
import { FamilyMember } from './family-member.entity';
import { money } from './shared';

/** ملف المستفيد (رب الأسرة أو الحالة الفردية) */
@Entity('beneficiaries')
@Index('UQ_beneficiaries_file_no', ['organizationId', 'fileNo'], { unique: true })
@Index('UQ_beneficiaries_national_id', ['organizationId', 'nationalId'], { unique: true, where: '"national_id" IS NOT NULL' })
export class Beneficiary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  /** رقم الملف: مسلسل داخل كل جمعية يبدأ من 1 */
  @Column({ name: 'file_no', type: 'int' })
  fileNo!: number;

  @Column({ name: 'full_name', length: 200 })
  fullName!: string;

  @Column({ name: 'national_id', type: 'varchar', length: 20, nullable: true })
  nationalId!: string | null;

  @Column({ type: 'varchar', length: 10 })
  gender!: Gender;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ name: 'alt_phone', type: 'varchar', length: 30, nullable: true })
  altPhone!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  /** الجنسية (لمطابقة اشتراطات الداعمين) */
  @Column({ type: 'varchar', length: 60, nullable: true })
  nationality!: string | null;

  /** citizen: مواطن · resident: مقيم · visitor: زائر */
  @Column({ type: 'varchar', length: 12, nullable: true })
  residency!: Residency | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address!: string | null;

  @Column({ name: 'marital_status', type: 'varchar', length: 20, nullable: true })
  maritalStatus!: MaritalStatus | null;

  @Column({ type: 'varchar', length: 20 })
  category!: Category;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'new' })
  status!: CaseStatus;

  @Column({ name: 'monthly_income', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: money })
  monthlyIncome!: number;

  @Column({ name: 'income_source', type: 'varchar', length: 200, nullable: true })
  incomeSource!: string | null;

  @Column({ name: 'housing_type', type: 'varchar', length: 20, nullable: true })
  housingType!: HousingType | null;

  @Column({ name: 'monthly_rent', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: money })
  monthlyRent!: number | null;

  @Column({ name: 'health_status', type: 'varchar', length: 300, nullable: true })
  healthStatus!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  /** staff: سجله موظف · portal: سجل بنفسه من بوابة المستفيدين */
  @Column({ type: 'varchar', length: 10, default: 'staff' })
  source!: 'staff' | 'portal';

  /** كلمة مرور بوابة المستفيد (الدخول برقم الهوية). فاضية = البوابة غير مفعلة له */
  @Column({ name: 'portal_password_hash', type: 'varchar', length: 100, nullable: true, select: false })
  portalPasswordHash!: string | null;

  /** سلّمته الجمعية كلمة مرور مؤقتة: يغيّرها قبل استخدام البوابة */
  @Column({ name: 'portal_must_change_password', default: false })
  portalMustChangePassword!: boolean;

  @Column({ name: 'portal_temp_expires_at', type: 'timestamptz', nullable: true })
  portalTempExpiresAt!: Date | null;

  /** رموز دخول البوابة الصادرة قبل هذا الوقت مرفوضة */
  @Column({ name: 'portal_sessions_valid_after', type: 'timestamptz', nullable: true })
  portalSessionsValidAfter!: Date | null;

  @Column({ name: 'portal_last_login_at', type: 'timestamptz', nullable: true })
  portalLastLoginAt!: Date | null;

  @OneToMany(() => FamilyMember, (m) => m.beneficiary)
  family?: FamilyMember[];

  @OneToMany(() => CaseResearch, (r) => r.beneficiary)
  researches?: CaseResearch[];

  @OneToMany(() => AidDisbursement, (a) => a.beneficiary)
  aids?: AidDisbursement[];

  @OneToMany(() => BeneficiaryDocument, (d) => d.beneficiary)
  documents?: BeneficiaryDocument[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
