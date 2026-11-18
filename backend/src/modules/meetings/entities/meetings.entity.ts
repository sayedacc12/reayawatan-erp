import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** أنواع الجهات: الجمعية العمومية، مجلس الإدارة، اللجان المتخصصة، فرق العمل الداخلية. ولكل نوع قسم مستقل لاجتماعاته وقراراته */
export const BODY_KINDS = ['general_assembly', 'board', 'committee', 'team'] as const;
export type BodyKind = (typeof BODY_KINDS)[number];
export const MEMBER_ROLES = ['chair', 'vice', 'secretary', 'member', 'rapporteur', 'advisor'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
/** عضو الجهة: مستخدم في النظام، أو عضو جمعية عمومية من نظام العضوية، أو شخص من خارج النظام */
export type PersonType = 'user' | 'member' | 'external';

export interface BodyMember {
  key: string; type: PersonType; userId: string | null; memberId: string | null; name: string; role: MemberRole; title: string | null;
  mobile: string | null; email: string | null; voting: boolean;
}

export type MeetingStatus = 'draft' | 'pending_approval' | 'scheduled' | 'in_progress' | 'held' | 'signing' | 'adopted' | 'cancelled';
export type MinutesStatus = 'none' | 'signing' | 'adopted';
export type Rsvp = 'pending' | 'accepted' | 'declined' | 'tentative';
export type Attendance = 'present' | 'remote' | 'absent' | 'excused';
export type SignStatus = 'none' | 'pending' | 'signed' | 'abstained' | 'not_signed';
export interface HistoryEntry { at: string; by: string; action: string; note?: string | null }
export interface FileRef { key: string; name: string; mime: string; size: number; byName: string; at: string }

/** إعدادات الاجتماعات لكل جمعية */
@Entity('mtg_settings')
export class MtgSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** مهلة التوقيع على المحضر بالأيام من إصداره */
  @Column({ name: 'sign_days', type: 'int', default: 5 })
  signDays!: number;

  /** المهلة الافتراضية لتنفيذ التوصيات بالأيام */
  @Column({ name: 'task_days', type: 'int', default: 30 })
  taskDays!: number;

  /** النصاب الافتراضي للجهات الجديدة (% من الأعضاء المصوتين) */
  @Column({ name: 'default_quorum', type: 'int', default: 50 })
  defaultQuorum!: number;

  /** نص ختامي يظهر أسفل المحاضر المطبوعة */
  @Column({ name: 'minutes_footer', type: 'varchar', length: 1000, nullable: true })
  minutesFooter!: string | null;

  /** عدادات الترقيم: {"BRD-2026": 4} */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  counters!: Record<string, number>;
}

/** الجهات: الجمعية العمومية، مجلس الإدارة، اللجان، فرق العمل */
@Entity('mtg_bodies')
@Index('UQ_mtg_bodies_code', ['organizationId', 'code'], { unique: true })
export class MtgBody {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: BodyKind;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** فريق العمل أو اللجنة المرتبطة بوحدة في الهيكل التنظيمي */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  /** معتمد خطط الاجتماعات (عادة رئيس الجهة). إن لم يحدد يعتمدها من له صلاحية الاعتماد */
  @Column({ name: 'approver_user_id', type: 'uuid', nullable: true })
  approverUserId!: string | null;

  /** أمين السر: يخطط الاجتماعات ويحرر المحاضر */
  @Column({ name: 'secretary_user_id', type: 'uuid', nullable: true })
  secretaryUserId!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  members!: BodyMember[];

  /** النصاب: نسبة الحاضرين من الأعضاء المصوتين */
  @Column({ name: 'quorum_percent', type: 'int', default: 50 })
  quorumPercent!: number;

  /** الجهة سرية: اجتماعاتها وقراراتها للحاضرين وأمين السر والمعتمد فقط */
  @Column({ name: 'is_confidential', type: 'boolean', default: false })
  isConfidential!: boolean;

  @Column({ name: 'term_start', type: 'date', nullable: true })
  termStart!: string | null;

  @Column({ name: 'term_end', type: 'date', nullable: true })
  termEnd!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** الاجتماع: التخطيط والاعتماد والدعوات والحضور وجدول الأعمال والمحضر */
@Entity('mtg_meetings')
@Index('UQ_mtg_meetings_ref', ['organizationId', 'refNo'], { unique: true })
@Index('UQ_mtg_meetings_verify', ['verifyCode'], { unique: true, where: 'verify_code IS NOT NULL' })
export class MtgMeeting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'body_id', type: 'uuid' })
  bodyId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: BodyKind;

  @Column({ name: 'ref_no', type: 'varchar', length: 30 })
  refNo!: string;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ name: 'meeting_type', type: 'varchar', length: 15, default: 'ordinary' })
  meetingType!: 'ordinary' | 'extraordinary';

  @Column({ type: 'varchar', length: 10, default: 'in_person' })
  mode!: 'in_person' | 'online' | 'hybrid';

  @Column({ type: 'varchar', length: 300, nullable: true })
  location!: string | null;

  @Column({ name: 'online_link', type: 'varchar', length: 500, nullable: true })
  onlineLink!: string | null;

  @Column({ name: 'meeting_date', type: 'date' })
  meetingDate!: string;

  @Column({ name: 'start_time', type: 'varchar', length: 5 })
  startTime!: string;

  @Column({ name: 'end_time', type: 'varchar', length: 5, nullable: true })
  endTime!: string | null;

  @Column({ type: 'text', nullable: true })
  objectives!: string | null;

  @Column({ name: 'is_confidential', type: 'boolean', default: false })
  isConfidential!: boolean;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status!: MeetingStatus;

  @Column({ name: 'approver_user_id', type: 'uuid', nullable: true })
  approverUserId!: string | null;

  @Column({ name: 'approver_name', type: 'varchar', length: 200, nullable: true })
  approverName!: string | null;

  @Column({ name: 'decision_note', type: 'varchar', length: 1000, nullable: true })
  decisionNote!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ name: 'quorum_met', type: 'boolean', nullable: true })
  quorumMet!: boolean | null;

  // ---- المحضر
  @Column({ name: 'minutes_status', type: 'varchar', length: 10, default: 'none' })
  minutesStatus!: MinutesStatus;

  @Column({ name: 'minutes_opening', type: 'text', nullable: true })
  minutesOpening!: string | null;

  @Column({ name: 'minutes_closing', type: 'text', nullable: true })
  minutesClosing!: string | null;

  @Column({ name: 'minutes_version', type: 'int', default: 0 })
  minutesVersion!: number;

  /** بصمة SHA-256 لنص المحضر وقت إصداره للتوقيع: كل توقيع مربوط بها، وأي تعديل يُبطل التوقيعات */
  @Column({ name: 'minutes_hash', type: 'varchar', length: 64, nullable: true })
  minutesHash!: string | null;

  /** نسخة المحضر المجمدة وقت الإصدار (ما يوقع عليه الحاضرون ويطبع) */
  @Column({ name: 'minutes_snapshot', type: 'jsonb', nullable: true })
  minutesSnapshot!: Record<string, unknown> | null;

  @Column({ name: 'minutes_issued_at', type: 'timestamptz', nullable: true })
  minutesIssuedAt!: Date | null;

  @Column({ name: 'sign_deadline', type: 'date', nullable: true })
  signDeadline!: string | null;

  @Column({ name: 'adopted_at', type: 'timestamptz', nullable: true })
  adoptedAt!: Date | null;

  /** electronic: كل التوقيعات إلكترونية، wet: النسخة الموقعة يدويًا، mixed: الاثنان */
  @Column({ name: 'adoption_method', type: 'varchar', length: 12, nullable: true })
  adoptionMethod!: 'electronic' | 'wet' | 'mixed' | null;

  @Column({ name: 'adoption_note', type: 'varchar', length: 1000, nullable: true })
  adoptionNote!: string | null;

  /** النسخة المطبوعة الموقعة بالتوقيع الحي بعد إعادة رفعها */
  @Column({ name: 'wet_copy', type: 'jsonb', nullable: true })
  wetCopy!: FileRef | null;

  /** رمز التحقق العام من صحة المحضر وتوقيعاته */
  @Column({ name: 'verify_code', type: 'varchar', length: 16, nullable: true })
  verifyCode!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  attachments!: (FileRef & { id: string })[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: HistoryEntry[];

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById!: string;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** المدعوون: الرد على الدعوة، الحضور، والتوقيع على المحضر */
@Entity('mtg_attendees')
@Index('IDX_mtg_attendees_meeting', ['meetingId'])
@Index('IDX_mtg_attendees_user', ['organizationId', 'userId'])
@Index('UQ_mtg_attendees_token', ['signTokenHash'], { unique: true, where: 'sign_token_hash IS NOT NULL' })
export class MtgAttendee {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId!: string;

  @Column({ type: 'varchar', length: 10 })
  type!: PersonType;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 12, default: 'member' })
  role!: MemberRole;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  mobile!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email!: string | null;

  @Column({ type: 'boolean', default: true })
  voting!: boolean;

  /** ضيف مدعو من خارج أعضاء الجهة (لا يدخل في النصاب) */
  @Column({ name: 'is_guest', type: 'boolean', default: false })
  isGuest!: boolean;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  rsvp!: Rsvp;

  @Column({ name: 'rsvp_note', type: 'varchar', length: 500, nullable: true })
  rsvpNote!: string | null;

  @Column({ name: 'rsvp_at', type: 'timestamptz', nullable: true })
  rsvpAt!: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  attendance!: Attendance | null;

  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checkedInAt!: Date | null;

  @Column({ name: 'sign_status', type: 'varchar', length: 12, default: 'none' })
  signStatus!: SignStatus;

  @Column({ name: 'signed_at', type: 'timestamptz', nullable: true })
  signedAt!: Date | null;

  /** password: بكلمة مرور الحساب، code: برابط ورمز تحقق للمدعوين من خارج النظام، wet: على النسخة الورقية */
  @Column({ name: 'sign_method', type: 'varchar', length: 10, nullable: true })
  signMethod!: 'password' | 'code' | 'wet' | null;

  /** بصمة المحضر التي وقّع عليها (تطابق minutes_hash وقت التوقيع) */
  @Column({ name: 'sign_hash', type: 'varchar', length: 64, nullable: true })
  signHash!: string | null;

  /** سبب الامتناع عن التوقيع */
  @Column({ name: 'sign_reason', type: 'varchar', length: 1000, nullable: true })
  signReason!: string | null;

  @Column({ name: 'sign_ip', type: 'varchar', length: 64, nullable: true })
  signIp!: string | null;

  @Column({ name: 'sign_token_hash', type: 'varchar', length: 64, nullable: true })
  signTokenHash!: string | null;

  @Column({ name: 'sign_code_hash', type: 'varchar', length: 64, nullable: true })
  signCodeHash!: string | null;

  @Column({ name: 'sign_link_expires', type: 'timestamptz', nullable: true })
  signLinkExpires!: Date | null;

  @Column({ name: 'sign_failures', type: 'int', default: 0 })
  signFailures!: number;

  @Column({ name: 'sign_locked_until', type: 'timestamptz', nullable: true })
  signLockedUntil!: Date | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}

/** بنود جدول الأعمال: لكل بند خانة المناقشات ثم التوصيات */
@Entity('mtg_agenda_items')
@Index('IDX_mtg_agenda_meeting', ['meetingId'])
export class MtgAgendaItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId!: string;

  @Column({ type: 'int', default: 0 })
  seq!: number;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'presenter_name', type: 'varchar', length: 200, nullable: true })
  presenterName!: string | null;

  @Column({ name: 'duration_minutes', type: 'int', nullable: true })
  durationMinutes!: number | null;

  /** ملخص المناقشات */
  @Column({ type: 'text', nullable: true })
  discussion!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status!: 'pending' | 'discussed' | 'deferred';
}

/** توصيات وقرارات البند: كل توصية لها مسؤول تتحول عند اعتماد المحضر إلى مهمة في نظام المهام */
@Entity('mtg_recommendations')
@Index('IDX_mtg_recs_meeting', ['meetingId'])
export class MtgRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId!: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ type: 'int', default: 0 })
  seq!: number;

  /** recommendation: توصية تُنفذ، decision: قرار يُسجل في سجل القرارات */
  @Column({ type: 'varchar', length: 15, default: 'recommendation' })
  kind!: 'recommendation' | 'decision';

  @Column({ type: 'text' })
  text!: string;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  supporters!: { userId: string; name: string }[];

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'votes_for', type: 'int', nullable: true })
  votesFor!: number | null;

  @Column({ name: 'votes_against', type: 'int', nullable: true })
  votesAgainst!: number | null;

  @Column({ name: 'votes_abstain', type: 'int', nullable: true })
  votesAbstain!: number | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @Column({ name: 'task_ref', type: 'varchar', length: 30, nullable: true })
  taskRef!: string | null;
}

export const MEETINGS_ENTITIES = [MtgSettings, MtgBody, MtgMeeting, MtgAttendee, MtgAgendaItem, MtgRecommendation];
