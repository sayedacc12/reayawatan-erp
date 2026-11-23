import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** نوع الجهة: شخص أو منشأة (شركة، جمعية، جهة حكومية...) */
export const PARTY_KINDS = { person: 'شخص', org: 'منشأة' } as const;
export type PartyKind = keyof typeof PARTY_KINDS;

/**
 * أدوار الجهة: كل دور يربط الجهة بسجلها في نظامها الأصلي دون نقل بياناته.
 * lead: عميل محتمل في هذا النظام نفسه.
 */
export const PARTY_ROLES = {
  customer: 'عميل', member: 'عضو', volunteer: 'متطوع', partner: 'شريك', lead: 'عميل محتمل',
} as const;
export type PartyRole = keyof typeof PARTY_ROLES;

/** قنوات التواصل التسويقي، ولكل قناة موافقة مستقلة */
export const CHANNELS = { email: 'البريد الإلكتروني', whatsapp: 'واتساب', sms: 'الرسائل النصية' } as const;
export type Channel = keyof typeof CHANNELS;

export const LEAD_STATUS = {
  new: 'جديد', contacted: 'تم التواصل', qualified: 'مؤهل', converted: 'تحول إلى جهة', disqualified: 'غير مؤهل',
} as const;
export type LeadStatus = keyof typeof LEAD_STATUS;
/** الحالات المفتوحة التي تحتاج متابعة */
export const OPEN_LEAD: LeadStatus[] = ['new', 'contacted', 'qualified'];

export const ACTIVITY_TYPES = {
  call: 'مكالمة', meeting: 'اجتماع أو زيارة', whatsapp: 'رسالة واتساب', email: 'بريد إلكتروني', task: 'مهمة', note: 'ملاحظة',
} as const;
export type ActivityType = keyof typeof ACTIVITY_TYPES;
/** أنشطة التواصل الفعلي التي تُحسب «أول تواصل» مع العميل المحتمل */
export const CONTACT_TYPES: ActivityType[] = ['call', 'meeting', 'whatsapp', 'email'];

export const DECISION_ROLES = { decision_maker: 'صاحب القرار', influencer: 'مؤثر في القرار', user: 'مستخدم أو منسق', other: 'أخرى' } as const;
export type DecisionRole = keyof typeof DECISION_ROLES;

export const ASSIGN_MODES = { manual: 'يدويًا من المدير', round_robin: 'آليًا بالتناوب بين أعضاء الفريق' } as const;
export type AssignMode = keyof typeof ASSIGN_MODES;

/** عنصر في قائمة قابلة للتعديل (المصادر، الاهتمامات، أسباب عدم التأهيل) */
export interface ListItem { key: string; label: string; isActive: boolean }
export interface Consent { granted: boolean; at: string; source: string; byName: string }
export type Consents = Partial<Record<Channel, Consent>>;
/** تغيير حقل في السجل: القيمة قبل التعديل وبعده */
export interface LogChange { field: string; from: unknown; to: unknown }
export interface LogEntry { action: string; note: string | null; byName: string; byId?: string | null; at: string; changes?: LogChange[] }

/** إعدادات النظام لكل منشأة */
@Entity('crm_settings')
export class CrmSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ default: false }) initialized!: boolean;
  /** مهلة التواصل الأول مع العميل المحتمل بالساعات */
  @Column({ name: 'sla_hours', type: 'int', default: 24 }) slaHours!: number;
  @Column({ name: 'assign_mode', type: 'varchar', length: 12, default: 'manual' }) assignMode!: AssignMode;
  /** فريق المبيعات وتنمية الموارد الذي يُوزَّع عليه العملاء المحتملون */
  @Column({ type: 'jsonb', default: () => `'[]'` }) team!: string[];
  /** مؤشر التناوب: آخر عضو أُسند إليه */
  @Column({ name: 'rr_cursor', type: 'int', default: 0 }) rrCursor!: number;
  /**
   * موضوعات رسائل «تواصل معنا» في الموقع التي تدخل عملاءَ محتملين (فارغة = لا شيء).
   * الافتراضي طلبات الشراكة فقط، لأن الاستفسارات العامة كثيرًا ما تكون من مستفيدين، والمستفيدون خارج التسويق.
   */
  @Column({ name: 'web_topics', type: 'jsonb', default: () => `'[]'` }) webTopics!: string[];
  /** all: كل الفريق يرى كل الجهات · own: يرى الموظف جهاته فقط (ومن يملك صلاحية «كل السجلات» يرى الكل) */
  @Column({ name: 'party_visibility', type: 'varchar', length: 6, default: 'all' }) partyVisibility!: 'all' | 'own';
  @Column({ type: 'jsonb', default: () => `'[]'` }) sources!: ListItem[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) interests!: ListItem[];
  @Column({ name: 'disqualify_reasons', type: 'jsonb', default: () => `'[]'` }) disqualifyReasons!: ListItem[];
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** الجهة: شخص أو منشأة، سجل واحد يجمع أدوارها في كل الأنظمة */
@Entity('crm_parties')
@Index('UQ_crm_parties_no', ['organizationId', 'partyNo'], { unique: true })
@Index('IDX_crm_parties_phone', ['organizationId', 'phone'])
@Index('IDX_crm_parties_email', ['organizationId', 'email'])
@Index('IDX_crm_parties_owner', ['organizationId', 'ownerId'])
export class CrmParty {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'party_no', type: 'int' }) partyNo!: number;
  @Column({ type: 'varchar', length: 6, default: 'person' }) kind!: PartyKind;
  @Column({ length: 250 }) name!: string;
  /** الجوال موحدًا على صيغة 05xxxxxxxx إن كان سعوديًا */
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  @Column({ name: 'vat_number', type: 'varchar', length: 15, nullable: true }) vatNumber!: string | null;
  @Column({ name: 'cr_number', type: 'varchar', length: 40, nullable: true }) crNumber!: string | null;
  /** الموظف المسؤول عن العلاقة */
  @Column({ name: 'owner_id', type: 'uuid', nullable: true }) ownerId!: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) source!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) tags!: string[];
  @Column({ type: 'jsonb', default: () => `'{}'` }) consents!: Consents;
  /** لا يُتواصل معه تسويقيًا بأي قناة */
  @Column({ name: 'do_not_contact', default: false }) doNotContact!: boolean;
  @Column({ type: 'varchar', length: 2000, nullable: true }) notes!: string | null;
  /** عند الدمج: الجهة التي دُمجت فيها هذه الجهة */
  @Column({ name: 'merged_into', type: 'uuid', nullable: true }) mergedInto!: string | null;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true }) createdByName!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** ربط الجهة بسجلها في نظام آخر (عميل، عضو، متطوع، شريك) */
@Entity('crm_party_links')
@Index('UQ_crm_party_links_ref', ['organizationId', 'role', 'refId'], { unique: true })
@Index('IDX_crm_party_links_party', ['organizationId', 'partyId'])
export class CrmPartyLink {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'party_id', type: 'uuid' }) partyId!: string;
  @Column({ type: 'varchar', length: 12 }) role!: PartyRole;
  @Column({ name: 'ref_id', type: 'uuid' }) refId!: string;
  @Column({ name: 'linked_by_name', type: 'varchar', length: 200 }) linkedByName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** أشخاص الاتصال في المنشأة */
@Entity('crm_contacts')
@Index('IDX_crm_contacts_party', ['organizationId', 'partyId'])
export class CrmContact {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'party_id', type: 'uuid' }) partyId!: string;
  @Column({ length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 150, nullable: true }) title!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) email!: string | null;
  @Column({ name: 'decision_role', type: 'varchar', length: 16, default: 'other' }) decisionRole!: DecisionRole;
  @Column({ name: 'is_primary', default: false }) isPrimary!: boolean;
  @Column({ type: 'varchar', length: 1000, nullable: true }) notes!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** العميل المحتمل: أول تواصل قبل أن يتأهل ويتحول إلى جهة */
@Entity('crm_leads')
@Index('UQ_crm_leads_no', ['organizationId', 'leadNo'], { unique: true })
@Index('IDX_crm_leads_status', ['organizationId', 'status', 'ownerId'])
@Index('IDX_crm_leads_phone', ['organizationId', 'phone'])
@Index('UQ_crm_leads_web', ['organizationId', 'webMessageId'], { unique: true, where: 'web_message_id IS NOT NULL' })
export class CrmLead {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'lead_no', type: 'int' }) leadNo!: number;
  @Column({ length: 200 }) name!: string;
  /** اسم المنشأة إن كان يمثل جهة */
  @Column({ type: 'varchar', length: 250, nullable: true }) company!: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) title!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) interest!: string | null;
  @Column({ type: 'varchar', length: 40 }) source!: string;
  /** اسم الحملة أو الفعالية التي جاء منها (الحملات الكاملة في مرحلة لاحقة) */
  @Column({ type: 'varchar', length: 200, nullable: true }) campaign!: string | null;
  @Column({ type: 'varchar', length: 4000, nullable: true }) message!: string | null;
  @Column({ type: 'varchar', length: 14, default: 'new' }) status!: LeadStatus;
  @Column({ name: 'owner_id', type: 'uuid', nullable: true }) ownerId!: string | null;
  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true }) assignedAt!: Date | null;
  /** آخر موعد للتواصل الأول حسب المهلة في الإعدادات */
  @Column({ name: 'due_at', type: 'timestamptz' }) dueAt!: Date;
  @Column({ name: 'first_contact_at', type: 'timestamptz', nullable: true }) firstContactAt!: Date | null;
  @Column({ name: 'disqualify_reason', type: 'varchar', length: 40, nullable: true }) disqualifyReason!: string | null;
  @Column({ name: 'disqualify_note', type: 'varchar', length: 1000, nullable: true }) disqualifyNote!: string | null;
  @Column({ name: 'party_id', type: 'uuid', nullable: true }) partyId!: string | null;
  @Column({ name: 'converted_at', type: 'timestamptz', nullable: true }) convertedAt!: Date | null;
  /** رسالة الموقع التي أنشأته (تمنع تكراره) */
  @Column({ name: 'web_message_id', type: 'uuid', nullable: true }) webMessageId!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @Column({ name: 'created_by_name', type: 'varchar', length: 200 }) createdByName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** النشاط: مكالمة أو زيارة أو رسالة أو مهمة أو ملاحظة، على جهة أو عميل محتمل */
@Entity('crm_activities')
@Index('IDX_crm_activities_owner', ['organizationId', 'ownerId', 'doneAt', 'dueAt'])
@Index('IDX_crm_activities_party', ['organizationId', 'partyId'])
@Index('IDX_crm_activities_lead', ['organizationId', 'leadId'])
export class CrmActivity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ type: 'varchar', length: 10 }) type!: ActivityType;
  @Column({ length: 250 }) subject!: string;
  @Column({ type: 'varchar', length: 4000, nullable: true }) details!: string | null;
  @Column({ name: 'due_at', type: 'timestamptz', nullable: true }) dueAt!: Date | null;
  @Column({ name: 'done_at', type: 'timestamptz', nullable: true }) doneAt!: Date | null;
  @Column({ type: 'varchar', length: 2000, nullable: true }) outcome!: string | null;
  @Column({ name: 'party_id', type: 'uuid', nullable: true }) partyId!: string | null;
  @Column({ name: 'lead_id', type: 'uuid', nullable: true }) leadId!: string | null;
  /**
   * نطاق الجهات المرتبطة حين يكون النشاط لأكثر من جهة: many (جهات مختارة) أو all (كل العملاء، أو كل الجهات إن لم يُحدد دور).
   * الجهات نفسها في crm_activity_parties، وpartyId يبقى فارغًا. null = جهة واحدة (partyId) أو عميل محتمل أو بلا ربط.
   */
  @Column({ type: 'varchar', length: 4, nullable: true }) audience!: ActivityAudience | null;
  /** دور الجهات حين يكون النطاق «الكل» (مثل customer)، وnull = كل الجهات */
  @Column({ name: 'audience_role', type: 'varchar', length: 12, nullable: true }) audienceRole!: PartyRole | null;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId!: string;
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true }) createdById!: string | null;
  @Column({ name: 'created_by_name', type: 'varchar', length: 200 }) createdByName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

export const ACTIVITY_AUDIENCE = { many: 'جهات مختارة', all: 'الكل' } as const;
export type ActivityAudience = keyof typeof ACTIVITY_AUDIENCE;
/** أقصى عدد للجهات المختارة يدويًا، وللجهات في نشاط «الكل» */
export const MAX_PICKED_PARTIES = 200;
export const MAX_AUDIENCE_PARTIES = 5000;
export const MAX_FOLLOWERS = 20;

/** الجهات المرتبطة بنشاط واحد لأكثر من جهة (لقطة وقت الإنشاء، فلا تُضاف إليه الجهات الجديدة لاحقًا) */
@Entity('crm_activity_parties')
@Index('IDX_crm_activity_parties_party', ['organizationId', 'partyId'])
@Index('UQ_crm_activity_parties', ['activityId', 'partyId'], { unique: true })
export class CrmActivityParty {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'activity_id', type: 'uuid' }) activityId!: string;
  @Column({ name: 'party_id', type: 'uuid' }) partyId!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
}

/** متابعو النشاط: يرونه في قائمتهم للاطلاع فقط، ولا ينجزونه ولا يحذفونه */
@Entity('crm_activity_followers')
@Index('IDX_crm_activity_followers_user', ['organizationId', 'userId'])
@Index('UQ_crm_activity_followers', ['activityId', 'userId'], { unique: true })
export class CrmActivityFollower {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'activity_id', type: 'uuid' }) activityId!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
}

/** سجل دمج الجهات المكررة: نسخة من الجهة المحذوفة كما كانت قبل الدمج */
@Entity('crm_merges')
@Index('IDX_crm_merges_kept', ['organizationId', 'keptId'])
export class CrmMerge {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'kept_id', type: 'uuid' }) keptId!: string;
  @Column({ name: 'removed_id', type: 'uuid' }) removedId!: string;
  @Column({ type: 'jsonb' }) snapshot!: Record<string, unknown>;
  @Column({ name: 'by_name', type: 'varchar', length: 200 }) byName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

export const CRM_ENTITIES = [CrmSettings, CrmParty, CrmPartyLink, CrmContact, CrmLead, CrmActivity, CrmActivityParty, CrmActivityFollower, CrmMerge];
