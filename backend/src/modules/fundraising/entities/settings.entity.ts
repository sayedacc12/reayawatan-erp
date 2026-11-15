import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToOne, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization, Role, User } from '../../../core/entities';
import { moneyCol } from './shared';

/** أنواع حقول سجل الداعمين التي يضيفها مدير النظام */
export type DonorFieldType = 'text' | 'textarea' | 'number' | 'percent' | 'mobile' | 'email' | 'date' | 'select' | 'checkbox';

export interface DonorField {
  key: string;
  label: string;
  type: DonorFieldType;
  required: boolean;
  options?: string[];
  min?: number | null;
  max?: number | null;
  /** حقل موقوف: لا يظهر في النموذج، وتبقى بياناته السابقة محفوظة */
  isActive: boolean;
}

export interface AccountRef { code: string | null; name: string | null }

/**
 * توجيه القيود المحاسبية لفرص التبرع:
 * الطرف المدين حسب نوع الفرصة (النقدية: الحساب البنكي المختار، العينية: المخزون، الوعد: ذمم الوعود)
 * والطرف الدائن حسب تصنيف كل بند في التوزيع.
 */
export interface JournalRouting {
  cash: { description: string | null };
  inKind: { debit: AccountRef; description: string | null };
  pledge: { debit: AccountRef; description: string | null };
  /** سداد الوعد: من البنك إلى ذمم الوعود */
  pledgeCollection: { description: string | null };
  credit: { operational: AccountRef; restricted: AccountRef; zakat: AccountRef; waqf: AccountRef; case: AccountRef };
}

export const DEFAULT_ROUTING: JournalRouting = {
  cash: { description: 'إثبات تبرع نقدي' },
  inKind: { debit: { code: '1140', name: 'مخزون التبرعات العينية' }, description: 'إثبات تبرع عيني' },
  pledge: { debit: { code: '1150', name: 'ذمم الداعمين - وعود بالدفع' }, description: 'إثبات وعد بالدفع' },
  pledgeCollection: { description: 'تحصيل وعد بالدفع' },
  credit: {
    operational: { code: '4110', name: 'إيرادات التبرعات التشغيلية (غير المقيدة)' },
    restricted: { code: '4120', name: 'إيرادات التبرعات المقيدة' },
    zakat: { code: '4130', name: 'إيرادات الزكاة' },
    waqf: { code: '4140', name: 'إيرادات تبرعات الأوقاف' },
    case: { code: '4150', name: 'إيرادات تبرعات الحالات' },
  },
};

/** إعدادات وحدة الموارد المالية لكل جمعية */
@Entity('fundraising_settings')
export class FundraisingSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @OneToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  /** الحقول الإضافية في سجل الداعمين */
  @Column({ name: 'donor_fields', type: 'jsonb', default: () => `'[]'` })
  donorFields!: DonorField[];

  @Column({ name: 'journal_routing', type: 'jsonb', nullable: true })
  journalRouting!: JournalRouting | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** مستويات الداعمين: ماسي، النخبة، بلاتيني، ذهبي... */
@Entity('fundraising_donor_levels')
export class DonorLevel {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization?: Organization;
  @Column({ length: 100 }) name!: string;
  @Column({ type: 'varchar', length: 20, default: '#e8b04b' }) color!: string;
  /** الحد الأدنى لإجمالي التبرعات في هذا المستوى (استرشادي) */
  @Column(moneyCol('min_amount', true)) minAmount!: number | null;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder!: number;
}

/** مدراء الدعم: موظفو تنمية الموارد المالية، أو جهة خارجية */
@Entity('fundraising_support_managers')
export class SupportManager {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization?: Organization;
  @Column({ length: 200 }) name!: string;
  /** employee: موظف بالجمعية · external: جهة خارجية */
  @Column({ type: 'varchar', length: 10, default: 'employee' }) kind!: 'employee' | 'external';
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId!: string | null;
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true }) @JoinColumn({ name: 'user_id' }) user?: User | null;
  @Column({ name: 'entity_name', type: 'varchar', length: 200, nullable: true }) entityName!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) email!: string | null;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** حسابات الجمعية البنكية التي تُحوَّل إليها التبرعات */
@Entity('fundraising_bank_accounts')
export class BankAccount {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization?: Organization;
  @Column({ name: 'bank_name', length: 200 }) bankName!: string;
  @Column({ name: 'account_name', type: 'varchar', length: 200, nullable: true }) accountName!: string | null;
  @Column({ name: 'account_number', length: 50 }) accountNumber!: string;
  @Column({ type: 'varchar', length: 34, nullable: true }) iban!: string | null;
  /** الحساب المقابل في دليل الحسابات (الطرف المدين في قيد التبرع النقدي) */
  @Column({ name: 'gl_code', type: 'varchar', length: 50, nullable: true }) glCode!: string | null;
  @Column({ name: 'gl_name', type: 'varchar', length: 200, nullable: true }) glName!: string | null;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** مشاريع الأوقاف التي يمكن توجيه التبرعات إليها */
@Entity('fundraising_waqf_projects')
export class WaqfProject {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization?: Organization;
  @Column({ length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 1000, nullable: true }) description!: string | null;
  @Column(moneyCol('target_amount', true)) targetAmount!: number | null;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/**
 * مراحل اعتماد فرص التبرع بالترتيب. القرارات: موافقة (للمرحلة التالية، والأخيرة = اعتماد نهائي)،
 * رفض (يلغي الفرصة مع السبب)، أو طلب تعديل (يعيدها للمرحلة السابقة مع السبب).
 */
@Entity('fundraising_approval_stages')
export class ApprovalStage {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization?: Organization;
  @Column({ length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 1000, nullable: true }) instructions!: string | null;
  @Column({ name: 'sort_order', type: 'int' }) sortOrder!: number;
  /** الدور المسؤول عن القرار (فارغ = أي مستخدم لديه صلاحية اعتماد الفرص) */
  @Column({ name: 'role_id', type: 'uuid', nullable: true }) roleId!: string | null;
  @ManyToOne(() => Role, { onDelete: 'SET NULL', nullable: true }) @JoinColumn({ name: 'role_id' }) role?: Role | null;
  @Column({ name: 'can_reject', default: true }) canReject!: boolean;
  @Column({ name: 'can_return', default: true }) canReturn!: boolean;
}
