import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrgUser } from '../auth/decorators';
import { RoleAssignment, User } from '../entities';
import { RolesService } from '../roles/roles.service';
import { CreateAssignmentDto } from './users.dto';

/** اليوم بتوقيت الرياض */
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

export type AssignmentState = 'upcoming' | 'active' | 'expired' | 'ended';
const STATE_AR: Record<AssignmentState, string> = { upcoming: 'لم يبدأ', active: 'ساري', expired: 'انتهت مدته', ended: 'أُنهي مبكرًا' };

/**
 * التكليفات: إسناد دور لمستخدم لمدة محددة (للشركة الصغيرة التي يحمل موظفها أكثر من عمل).
 * صلاحيات الدور تعمل من تاريخ البداية حتى نهاية يوم تاريخ النهاية ثم تسقط تلقائيًا، أو تبقى مفتوحة بلا تاريخ نهاية حتى يُنهى التكليف.
 * الإسناد يخضع لقاعدة الأدوار نفسها: لا يمنح أحد صلاحية لا يملكها.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    @InjectRepository(RoleAssignment) private readonly repo: Repository<RoleAssignment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly roles: RolesService,
  ) {}

  state(a: RoleAssignment, t = today()): AssignmentState {
    if (a.endedAt) return 'ended';
    if (a.startDate > t) return 'upcoming';
    if (a.endDate && a.endDate < t) return 'expired';
    return 'active';
  }

  async list(actor: OrgUser, userId?: string) {
    const rows = await this.repo.find({
      where: { organizationId: actor.organizationId, ...(userId ? { userId } : {}) },
      relations: { role: true, user: true },
      order: { startDate: 'DESC', createdAt: 'DESC' },
    });
    const t = today();
    return rows.map((a) => this.present(a, t));
  }

  async create(actor: OrgUser, userId: string, dto: CreateAssignmentDto) {
    const org = actor.organizationId;
    const user = await this.users.findOne({ where: { id: userId, organizationId: org } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    // لا يكلّف أحد نفسه، حتى لا يمدّ تكليفًا مؤقتًا لنفسه فيصبح دائمًا (مدير النظام يملك كل الصلاحيات أصلًا)
    if (userId === actor.id && !actor.isSuperadmin) throw new ForbiddenException('لا يمكنك تكليف نفسك؛ يكلّفك مستخدم آخر');
    const endDate = dto.endDate ?? null;
    if (endDate && endDate < dto.startDate) throw new BadRequestException('تاريخ النهاية قبل تاريخ البداية');
    if (endDate && endDate < today()) throw new BadRequestException('تاريخ النهاية مضى؛ التكليف لن يعمل');
    const [role] = await this.roles.loadForAssignment(actor, [dto.roleId]);
    await this.roles.assertCanAssign(actor, [role]);
    const overlap = await this.repo.createQueryBuilder('a')
      .where('a.organization_id = :org AND a.user_id = :userId AND a.role_id = :roleId AND a.ended_at IS NULL', { org, userId, roleId: role.id })
      .andWhere('(CAST(:end AS date) IS NULL OR a.start_date <= :end) AND (a.end_date IS NULL OR a.end_date >= :start)', { start: dto.startDate, end: endDate })
      .getExists();
    if (overlap) throw new ConflictException('للمستخدم تكليف بهذا الدور في مدة متداخلة؛ أنهِه أو عدّل التواريخ');
    const saved = await this.repo.save(this.repo.create({
      organizationId: org, userId, roleId: role.id, startDate: dto.startDate, endDate,
      note: dto.note?.trim() || null, createdByName: actor.fullName,
    }));
    return this.get(actor, saved.id);
  }

  /** إنهاء التكليف الآن (قبل موعده) */
  async end(actor: OrgUser, id: string) {
    const a = await this.repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!a) throw new NotFoundException('التكليف غير موجود');
    const s = this.state(a);
    if (s === 'ended' || s === 'expired') throw new ConflictException('التكليف منتهٍ بالفعل');
    await this.repo.update({ id, organizationId: actor.organizationId }, { endedAt: new Date(), endedByName: actor.fullName });
    return this.get(actor, id);
  }

  private async get(actor: OrgUser, id: string) {
    const a = await this.repo.findOne({ where: { id, organizationId: actor.organizationId }, relations: { role: true, user: true } });
    if (!a) throw new NotFoundException('التكليف غير موجود');
    return this.present(a, today());
  }

  private present(a: RoleAssignment, t: string) {
    const state = this.state(a, t);
    return {
      id: a.id, userId: a.userId, userName: a.user?.fullName ?? null, roleId: a.roleId, roleName: a.role?.name ?? null,
      startDate: a.startDate, endDate: a.endDate, note: a.note, state, stateLabel: STATE_AR[state],
      createdByName: a.createdByName, createdAt: a.createdAt, endedAt: a.endedAt, endedByName: a.endedByName,
    };
  }
}
