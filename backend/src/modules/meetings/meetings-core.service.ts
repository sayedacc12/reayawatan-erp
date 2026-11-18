import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { CommsCore } from '../comms/comms-core.service';
import { MtgAttendee, MtgBody, MtgMeeting, MtgSettings } from './entities/meetings.entity';
import { KIND_READ, MEETINGS_PERMISSIONS as P } from './meetings.manifest';

export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export const KIND_AR: Record<string, string> = { general_assembly: 'الجمعية العمومية', board: 'مجلس الإدارة', committee: 'اللجان المتخصصة', team: 'فرق العمل' };
export const KIND_PREFIX: Record<string, string> = { general_assembly: 'GA', board: 'BRD', committee: 'CMT', team: 'TM' };
export const ROLE_AR: Record<string, string> = { chair: 'الرئيس', vice: 'نائب الرئيس', secretary: 'أمين السر', member: 'عضو', rapporteur: 'مقرر', advisor: 'مستشار' };
export const STATUS_AR: Record<string, string> = {
  draft: 'مسودة', pending_approval: 'بانتظار الاعتماد', scheduled: 'معتمد ـ الدعوات مرسلة', in_progress: 'منعقد الآن', held: 'انتهى ـ تحرير المحضر',
  signing: 'المحضر بانتظار التوقيع', adopted: 'المحضر معتمد', cancelled: 'ملغى',
};
export const RSVP_AR: Record<string, string> = { pending: 'لم يرد', accepted: 'سيحضر', declined: 'معتذر', tentative: 'مبدئيًا' };
export const ATT_AR: Record<string, string> = { present: 'حاضر', remote: 'حاضر عن بعد', absent: 'غائب', excused: 'غائب بعذر' };
export const SIGN_AR: Record<string, string> = { none: '—', pending: 'لم يوقع بعد', signed: 'وقّع', abstained: 'امتنع عن التوقيع', not_signed: 'لم يوقع' };
export const MODE_AR: Record<string, string> = { in_person: 'حضوري', online: 'عن بعد', hybrid: 'حضوري وعن بعد' };
export const TYPE_AR: Record<string, string> = { ordinary: 'عادي', extraordinary: 'غير عادي' };

const bad = (m: string): never => {
  throw new BadRequestException(m);
};

/** القوائم المشتركة وقواعد الاطلاع والإدارة في نظام الاجتماعات */
@Injectable()
export class MeetingsCore {
  constructor(private readonly db: DataSource, readonly comms: CommsCore) {}

  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(MtgSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return s;
  }

  async nextRef(em: EntityManager, org: string, prefix: string, year: string) {
    await this.settings(org, em);
    const key = `${prefix}-${year}`;
    const res = await em.query(
      `UPDATE mtg_settings SET counters = jsonb_set(counters, ARRAY[$2::text], to_jsonb(COALESCE((counters->>$2)::int, 0) + 1)) WHERE organization_id = $1 RETURNING (counters->>$2)::int AS n`,
      [org, key],
    );
    const rows = Array.isArray(res[0]) ? res[0] : res;
    return { refNo: `${key}-${String(rows[0].n).padStart(2, '0')}`, seq: Number(rows[0].n) };
  }

  can(u: OrgUser, p: string) {
    return u.isSuperadmin || u.permissions.includes(p);
  }

  /** أعضاء الجمعية العمومية النشطون من نظام العضوية (المصوتون حسب نوع العضوية) */
  async assemblyMembers(org: string) {
    try {
      const rows: { id: string; full_name: string; mobile: string | null; email: string | null; member_no: number; voting: boolean | null }[] = await this.db.query(
        `SELECT m.id, m.full_name, m.mobile, m.email, m.member_no,
                (SELECT (t->>'votingRights')::boolean FROM mem_settings s, jsonb_array_elements(s.types) t WHERE s.organization_id = m.organization_id AND t->>'code' = m.type_code LIMIT 1) AS voting
           FROM mem_members m WHERE m.organization_id = $1 AND m.status = 'active' ORDER BY m.member_no`, [org],
      );
      return rows.map((r) => ({ id: r.id, fullName: r.full_name, mobile: r.mobile, email: r.email, memberNo: r.member_no, voting: r.voting !== false }));
    } catch {
      return [];
    }
  }

  async memberOf(org: string, id: string, em: EntityManager = this.db.manager) {
    const [m] = await em.query(`SELECT id, full_name, mobile, email FROM mem_members WHERE id = $1 AND organization_id = $2`, [id, org]).catch(() => []);
    if (!m) bad('عضو الجمعية العمومية غير موجود');
    return { id: m.id as string, fullName: m.full_name as string, mobile: m.mobile as string | null, email: m.email as string | null };
  }

  // ---------------- الاطلاع والإدارة ----------------

  /**
   * من يرى الاجتماع: المدعوون، ومنشئه، وأمين سر الجهة ومعتمدها، ومن يملك صلاحية الاطلاع على نوع الجهة أو أمانة المجالس.
   * الاجتماع السري: للمدعوين وأمين السر والمعتمد ومنشئه فقط.
   */
  canSee(u: OrgUser, m: Pick<MtgMeeting, 'createdById' | 'isConfidential' | 'kind'>, body: Pick<MtgBody, 'secretaryUserId' | 'approverUserId'>, attendees: Pick<MtgAttendee, 'userId'>[]) {
    if (m.createdById === u.id || body.secretaryUserId === u.id || body.approverUserId === u.id || attendees.some((a) => a.userId === u.id)) return true;
    if (m.isConfidential) return false;
    return this.can(u, P.manage) || this.can(u, KIND_READ[m.kind]);
  }

  canManage(u: OrgUser, m: Pick<MtgMeeting, 'createdById' | 'isConfidential' | 'kind'>, body: Pick<MtgBody, 'secretaryUserId'>) {
    if (body.secretaryUserId === u.id || m.createdById === u.id) return true;
    return !m.isConfidential && this.can(u, P.manage);
  }

  /** تنظيم اجتماع على هذه الجهة: أمانة المجالس، أو أمين سرها، أو مدير فريق العمل لفرقه */
  canOrganize(u: OrgUser, body: MtgBody) {
    if (body.secretaryUserId === u.id || this.can(u, P.manage)) return true;
    return body.kind === 'team' && this.can(u, P.teamsManage) && (body.createdById === u.id || body.members.some((m) => m.userId === u.id && ['chair', 'secretary'].includes(m.role)));
  }

  /** معتمد خطة الاجتماع: المعتمد المحدد في الجهة، وإلا من يملك صلاحية الاعتماد */
  canApprove(u: OrgUser, body: Pick<MtgBody, 'approverUserId'>) {
    return body.approverUserId ? body.approverUserId === u.id : this.can(u, P.approve);
  }

  /** شرط SQL لما يحق رؤيته من الاجتماعات (m = mtg_meetings، b = mtg_bodies) */
  visibleSql(u: OrgUser, idx: number) {
    const kinds = Object.entries(KIND_READ).filter(([, p]) => this.can(u, p)).map(([k]) => `'${k}'`);
    const all = this.can(u, P.manage);
    return `(m.created_by_id = $${idx} OR b.secretary_user_id = $${idx} OR b.approver_user_id = $${idx}
      OR EXISTS (SELECT 1 FROM mtg_attendees a WHERE a.meeting_id = m.id AND a.user_id = $${idx})
      ${all ? 'OR NOT m.is_confidential' : kinds.length ? `OR (NOT m.is_confidential AND m.kind IN (${kinds.join(',')}))` : ''})`;
  }

  forbid(): never {
    throw new ForbiddenException('هذا الاجتماع ليس متاحًا لك');
  }

  notFound(what: string): never {
    throw new NotFoundException(`${what} غير موجود`);
  }
}
