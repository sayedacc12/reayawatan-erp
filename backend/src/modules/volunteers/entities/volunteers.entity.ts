import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};

// ---------------- أنواع مشتركة ----------------

export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** حقل في نموذج مرن (تسجيل المتطوع، الفعالية، تقرير الإغلاق) يعرّفه مدير النظام من الإعدادات */
export interface FormField { key: string; label: string; type: FieldType; required: boolean; options?: string[]; placeholder?: string }

/** عنصر في قائمة قابلة للتعريف (أنواع التطوع، المجالات، تصنيفات الفعاليات) */
export interface LookupItem { code: string; name: string; description?: string | null; isActive: boolean }

/** مرحلة اعتماد الفعاليات (الدور فارغ = أي مستخدم معه صلاحية اعتماد الفعاليات) */
export interface EventStage { name: string; roleId: string | null }

export const QUESTION_TYPES = ['rating', 'yesno', 'text'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export interface SurveyQuestion { key: string; text: string; type: QuestionType; required: boolean }
export const AUDIENCES = ['volunteer', 'beneficiary'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** فقرة في عقد التطوع: تُضاف وتُحذف وتُوقف من الإعدادات، وتقبل متغيرات مثل {اسم المتطوع} */
export interface ContractClause { key: string; title: string; body: string; isActive: boolean }

/** قسم في لائحة التطوع أو ميثاقه */
export interface DocSection { title: string; body: string }

export interface CertificateTemplates {
  hoursTitle: string;
  hoursBody: string;
  thanksTitle: string;
  thanksBody: string;
  signatoryName: string;
  signatoryTitle: string;
}

export type VolunteerStatus = 'pending' | 'active' | 'inactive' | 'rejected';
export type EventKind = 'field' | 'online';
export type EventStatus = 'draft' | 'in_review' | 'returned' | 'rejected' | 'approved' | 'closed' | 'cancelled';
export type ParticipationStatus = 'registered' | 'attended' | 'absent';
export type CertificateKind = 'hours' | 'thanks';
export type ContractStatus = 'issued' | 'signed' | 'cancelled';
export type TicketKind = 'complaint' | 'suggestion' | 'inquiry';
export type TicketStatus = 'open' | 'in_progress' | 'closed';

export interface ApprovalLog { stage: string; decision: 'submit' | 'approve' | 'return' | 'reject' | 'close' | 'cancel'; byName: string; at: string; note: string | null }

// ---------------- الإعدادات ----------------

/** إعدادات نظام التطوع لكل جمعية: النماذج المرنة والقوائم ومراحل الاعتماد والقوالب والترقيم */
@Entity('vol_settings')
export class VolSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** حقول إضافية في نموذج تسجيل المتطوع (فوق البيانات الأساسية الثابتة) */
  @Column({ name: 'registration_fields', type: 'jsonb', default: () => `'[]'` })
  registrationFields!: FormField[];

  /** حقول إضافية في نموذج إنشاء الفعالية */
  @Column({ name: 'event_fields', type: 'jsonb', default: () => `'[]'` })
  eventFields!: FormField[];

  /** حقول إضافية في نموذج تقرير إغلاق الفعالية */
  @Column({ name: 'closure_fields', type: 'jsonb', default: () => `'[]'` })
  closureFields!: FormField[];

  @Column({ name: 'volunteer_types', type: 'jsonb', default: () => `'[]'` })
  volunteerTypes!: LookupItem[];

  /** مجالات التطوع المتاحة في الشركة */
  @Column({ name: 'volunteer_fields', type: 'jsonb', default: () => `'[]'` })
  volunteerFields!: LookupItem[];

  @Column({ name: 'event_categories', type: 'jsonb', default: () => `'[]'` })
  eventCategories!: LookupItem[];

  @Column({ name: 'event_stages', type: 'jsonb', default: () => `'[]'` })
  eventStages!: EventStage[];

  /** أسئلة استبانة الرضا لكل فئة: المتطوعون والمستفيدون */
  @Column({ name: 'survey_questions', type: 'jsonb', default: () => `'{}'` })
  surveyQuestions!: Partial<Record<Audience, SurveyQuestion[]>>;

  @Column({ name: 'contract_clauses', type: 'jsonb', default: () => `'[]'` })
  contractClauses!: ContractClause[];

  @Column({ name: 'certificate_templates', type: 'jsonb', default: () => `'{}'` })
  certificateTemplates!: Partial<CertificateTemplates>;

  /** صفحة التسجيل العامة للمتطوعين والشكاوى (رابط /v/<معرف الشركة>) */
  @Column({ name: 'public_registration', type: 'boolean', default: true })
  publicRegistration!: boolean;

  /** تُضبط مرة عند أول فتح للإعدادات بالقيم الافتراضية */
  @Column({ type: 'boolean', default: false })
  initialized!: boolean;

  @Column({ name: 'next_volunteer_no', type: 'int', default: 1 })
  nextVolunteerNo!: number;

  @Column({ name: 'next_event_no', type: 'int', default: 1 })
  nextEventNo!: number;

  @Column({ name: 'next_certificate_no', type: 'int', default: 1 })
  nextCertificateNo!: number;

  @Column({ name: 'next_contract_no', type: 'int', default: 1 })
  nextContractNo!: number;

  @Column({ name: 'next_ticket_no', type: 'int', default: 1 })
  nextTicketNo!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** إصدارات لائحة التطوع وميثاقه: كل حفظ إصدار جديد، والساري هو الأحدث */
@Entity('vol_document_versions')
@Index('UQ_vol_document_versions', ['organizationId', 'kind', 'version'], { unique: true })
export class VolDocumentVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** policy = لائحة التطوع، charter = ميثاق التطوع */
  @Column({ type: 'varchar', length: 20 })
  kind!: 'policy' | 'charter';

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'jsonb' })
  sections!: DocSection[];

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200 })
  approvedByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

// ---------------- المتطوعون ----------------

@Entity('vol_volunteers')
@Index('UQ_vol_volunteers_org_no', ['organizationId', 'volunteerNo'], { unique: true })
@Index('UQ_vol_volunteers_org_nid', ['organizationId', 'nationalId'], { unique: true })
export class VolVolunteer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'volunteer_no', type: 'int' })
  volunteerNo!: number;

  @Column({ name: 'full_name', type: 'varchar', length: 200 })
  fullName!: string;

  @Column({ name: 'national_id', type: 'varchar', length: 20 })
  nationalId!: string;

  @Column({ type: 'varchar', length: 20 })
  mobile!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 10 })
  gender!: 'male' | 'female';

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  qualification!: string | null;

  /** نوع التطوع (رمز من الإعدادات) */
  @Column({ name: 'type_code', type: 'varchar', length: 40, nullable: true })
  typeCode!: string | null;

  /** مجالات التطوع المفضلة (رموز من الإعدادات) */
  @Column({ name: 'field_codes', type: 'jsonb', default: () => `'[]'` })
  fieldCodes!: string[];

  @Column({ type: 'varchar', length: 1000, nullable: true })
  skills!: string | null;

  /** أوقات الإتاحة: صباحي، مسائي، عطلة نهاية الأسبوع، عن بعد... */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  availability!: string[];

  /** إجابات الحقول الإضافية في نموذج التسجيل */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  answers!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: VolunteerStatus;

  /** staff = سجّله موظف، public = سجّل نفسه من الصفحة العامة */
  @Column({ type: 'varchar', length: 10, default: 'staff' })
  source!: 'staff' | 'public';

  @Column({ name: 'joined_on', type: 'date', nullable: true })
  joinedOn!: string | null;

  @Column({ name: 'status_note', type: 'varchar', length: 1000, nullable: true })
  statusNote!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- الفعاليات ----------------

@Entity('vol_events')
@Index('UQ_vol_events_org_no', ['organizationId', 'eventNo'], { unique: true })
@Index('UQ_vol_events_survey_token', ['surveyToken'], { unique: true })
export class VolEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'event_no', type: 'varchar', length: 30 })
  eventNo!: string;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  /** field = ميدانية، online = عن بعد */
  @Column({ type: 'varchar', length: 10 })
  kind!: EventKind;

  @Column({ name: 'category_code', type: 'varchar', length: 40, nullable: true })
  categoryCode!: string | null;

  @Column({ name: 'field_codes', type: 'jsonb', default: () => `'[]'` })
  fieldCodes!: string[];

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  objectives!: string | null;

  /** الموقع للفعالية الميدانية */
  @Column({ type: 'varchar', length: 300, nullable: true })
  location!: string | null;

  /** المنصة ورابط الدخول للفعالية عن بعد */
  @Column({ type: 'varchar', length: 100, nullable: true })
  platform!: string | null;

  @Column({ name: 'online_link', type: 'varchar', length: 500, nullable: true })
  onlineLink!: string | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ name: 'start_time', type: 'varchar', length: 5, nullable: true })
  startTime!: string | null;

  @Column({ name: 'end_time', type: 'varchar', length: 5, nullable: true })
  endTime!: string | null;

  /** الساعات التطوعية المعتمدة لكل متطوع حضر (تُعدّل لكل متطوع عند التحضير) */
  @Column({ name: 'planned_hours', type: 'numeric', precision: 6, scale: 2, transformer: num, default: 0 })
  plannedHours!: number;

  @Column({ name: 'volunteers_needed', type: 'int', default: 0 })
  volunteersNeeded!: number;

  @Column({ name: 'target_beneficiaries', type: 'int', default: 0 })
  targetBeneficiaries!: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: num, default: 0 })
  budget!: number;

  @Column({ name: 'supervisor_name', type: 'varchar', length: 200, nullable: true })
  supervisorName!: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  answers!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status!: EventStatus;

  /** المرحلة الحالية في مسار الاعتماد (أثناء in_review) */
  @Column({ name: 'stage_index', type: 'int', default: 0 })
  stageIndex!: number;

  /** مراحل الاعتماد وقت الإرسال (نسخة ثابتة حتى لو تغيرت الإعدادات) */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  stages!: EventStage[];

  @Column({ name: 'approval_log', type: 'jsonb', default: () => `'[]'` })
  approvalLog!: ApprovalLog[];

  // ---- تقرير الإغلاق ----
  @Column({ name: 'actual_beneficiaries', type: 'int', nullable: true })
  actualBeneficiaries!: number | null;

  @Column({ name: 'closure_summary', type: 'text', nullable: true })
  closureSummary!: string | null;

  @Column({ type: 'text', nullable: true })
  achievements!: string | null;

  @Column({ type: 'text', nullable: true })
  challenges!: string | null;

  @Column({ type: 'text', nullable: true })
  recommendations!: string | null;

  @Column({ name: 'actual_cost', type: 'numeric', precision: 14, scale: 2, transformer: num, nullable: true })
  actualCost!: number | null;

  @Column({ name: 'closure_answers', type: 'jsonb', default: () => `'{}'` })
  closureAnswers!: Record<string, unknown>;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'closed_by_name', type: 'varchar', length: 200, nullable: true })
  closedByName!: string | null;

  // ---- استبانة الرضا ----
  /** رابط الاستبانة العام (يُنشأ عند إصدار الاستبانة) */
  @Column({ name: 'survey_token', type: 'varchar', length: 40, nullable: true })
  surveyToken!: string | null;

  /** أسئلة الاستبانة وقت إصدارها */
  @Column({ name: 'survey_questions', type: 'jsonb', nullable: true })
  surveyQuestions!: Partial<Record<Audience, SurveyQuestion[]>> | null;

  @Column({ name: 'survey_open', type: 'boolean', default: false })
  surveyOpen!: boolean;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** مشاركة متطوع في فعالية: الترشيح ثم التحضير وساعاته */
@Entity('vol_participations')
@Index('UQ_vol_participations', ['eventId', 'volunteerId'], { unique: true })
@Index('IDX_vol_participations_vol', ['organizationId', 'volunteerId'])
export class VolParticipation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'volunteer_id', type: 'uuid' })
  volunteerId!: string;

  /** دور المتطوع في الفعالية: قائد فريق، منظم، مسعف... */
  @Column({ type: 'varchar', length: 100, nullable: true })
  role!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'registered' })
  status!: ParticipationStatus;

  @Column({ type: 'numeric', precision: 6, scale: 2, transformer: num, default: 0 })
  hours!: number;

  /** تقييم المشرف لأداء المتطوع من 5 */
  @Column({ type: 'int', nullable: true })
  rating!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** ردود استبانة الرضا (متطوعون أو مستفيدون مشاركون في الفعالية) */
@Entity('vol_survey_responses')
@Index('IDX_vol_survey_responses_event', ['organizationId', 'eventId'])
export class VolSurveyResponse {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ type: 'varchar', length: 20 })
  audience!: Audience;

  @Column({ name: 'respondent_name', type: 'varchar', length: 200, nullable: true })
  respondentName!: string | null;

  @Column({ type: 'jsonb' })
  answers!: Record<string, unknown>;

  /** متوسط أسئلة التقييم محوّلًا لنسبة من 100 (null إن لم توجد أسئلة تقييم) */
  @Column({ type: 'numeric', precision: 5, scale: 2, transformer: num, nullable: true })
  score!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

// ---------------- الشهادات والعقود ----------------

@Entity('vol_certificates')
@Index('UQ_vol_certificates_org_no', ['organizationId', 'certificateNo'], { unique: true })
@Index('UQ_vol_certificates_code', ['verifyCode'], { unique: true })
export class VolCertificate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'certificate_no', type: 'varchar', length: 30 })
  certificateNo!: string;

  @Column({ name: 'volunteer_id', type: 'uuid' })
  volunteerId!: string;

  /** hours = شهادة ساعات تطوع، thanks = شهادة شكر */
  @Column({ type: 'varchar', length: 10 })
  kind!: CertificateKind;

  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId!: string | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, transformer: num, default: 0 })
  hours!: number;

  @Column({ name: 'period_from', type: 'date', nullable: true })
  periodFrom!: string | null;

  @Column({ name: 'period_to', type: 'date', nullable: true })
  periodTo!: string | null;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** نص الشهادة بعد تعبئة المتغيرات */
  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'signatory_name', type: 'varchar', length: 200, nullable: true })
  signatoryName!: string | null;

  @Column({ name: 'signatory_title', type: 'varchar', length: 200, nullable: true })
  signatoryTitle!: string | null;

  /** رمز التحقق من صحة الشهادة */
  @Column({ name: 'verify_code', type: 'varchar', length: 20 })
  verifyCode!: string;

  @Column({ name: 'issued_on', type: 'date' })
  issuedOn!: string;

  @Column({ name: 'issued_by_name', type: 'varchar', length: 200 })
  issuedByName!: string;

  @Column({ name: 'is_revoked', type: 'boolean', default: false })
  isRevoked!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** عقد تطوع صادر لمتطوع: نسخة ثابتة من الفقرات المفعلة وقت الإصدار */
@Entity('vol_contracts')
@Index('UQ_vol_contracts_org_no', ['organizationId', 'contractNo'], { unique: true })
@Index('UQ_vol_contracts_token', ['signToken'], { unique: true })
export class VolContract {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'contract_no', type: 'varchar', length: 30 })
  contractNo!: string;

  @Column({ name: 'volunteer_id', type: 'uuid' })
  volunteerId!: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  /** الفقرات بعد تعبئة المتغيرات */
  @Column({ type: 'jsonb' })
  clauses!: { title: string; body: string }[];

  @Column({ type: 'varchar', length: 20, default: 'issued' })
  status!: ContractStatus;

  @Column({ name: 'sign_token', type: 'varchar', length: 40 })
  signToken!: string;

  @Column({ name: 'signed_name', type: 'varchar', length: 200, nullable: true })
  signedName!: string | null;

  @Column({ name: 'signed_at', type: 'timestamptz', nullable: true })
  signedAt!: Date | null;

  /** electronic = وقّعه المتطوع إلكترونيًا، paper = وقّعه ورقيًا وسجّله الموظف */
  @Column({ name: 'signed_via', type: 'varchar', length: 20, nullable: true })
  signedVia!: 'electronic' | 'paper' | null;

  @Column({ name: 'issued_by_name', type: 'varchar', length: 200 })
  issuedByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

// ---------------- الشكاوى والمقترحات والاستفسارات ----------------

@Entity('vol_tickets')
@Index('UQ_vol_tickets_org_no', ['organizationId', 'ticketNo'], { unique: true })
export class VolTicket {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'ticket_no', type: 'varchar', length: 30 })
  ticketNo!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: TicketKind;

  @Column({ name: 'sender_name', type: 'varchar', length: 200 })
  senderName!: string;

  @Column({ name: 'sender_mobile', type: 'varchar', length: 20, nullable: true })
  senderMobile!: string | null;

  @Column({ name: 'sender_email', type: 'varchar', length: 200, nullable: true })
  senderEmail!: string | null;

  /** volunteer = متطوع، beneficiary = مستفيد، other = آخر */
  @Column({ name: 'sender_type', type: 'varchar', length: 20, default: 'volunteer' })
  senderType!: 'volunteer' | 'beneficiary' | 'other';

  @Column({ name: 'volunteer_id', type: 'uuid', nullable: true })
  volunteerId!: string | null;

  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId!: string | null;

  @Column({ type: 'varchar', length: 250 })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status!: TicketStatus;

  @Column({ type: 'text', nullable: true })
  reply!: string | null;

  @Column({ name: 'replied_by_name', type: 'varchar', length: 200, nullable: true })
  repliedByName!: string | null;

  @Column({ name: 'replied_at', type: 'timestamptz', nullable: true })
  repliedAt!: Date | null;

  /** رمز المتابعة الذي يحصل عليه المرسل من الصفحة العامة */
  @Column({ name: 'track_code', type: 'varchar', length: 20 })
  trackCode!: string;

  @Column({ type: 'varchar', length: 10, default: 'staff' })
  source!: 'staff' | 'public';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const VOL_ENTITIES = [
  VolSettings, VolDocumentVersion, VolVolunteer, VolEvent, VolParticipation, VolSurveyResponse, VolCertificate, VolContract, VolTicket,
];
