import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { ModuleCatalogService } from '../../core/modules/module-catalog.service';
import { RiskContinuity, RiskCrisisEvent, RiskCrisisTeam, RiskItem, RiskTask } from './entities/risk.entity';
import { assertEditable, criticality, markEdited } from './risk-calc';
import { ContinuityDto, CrisisActivateDto, CrisisCloseDto, CrisisLogDto, CrisisTeamDto } from './risk.dto';
import { RiskCore, today } from './risk-core.service';

/**
 * استمرارية الأعمال: تحليل أثر التوقف وخطط التعافي، وفرق الأزمات والكوارث بلائحة صلاحياتها،
 * وتفعيل الأزمة الذي يمنح الأعضاء صلاحيات الطوارئ في النظام فورًا ويسحبها عند الإنهاء.
 */
@Injectable()
export class ContinuityService {
  constructor(private readonly db: DataSource, private readonly core: RiskCore, private readonly catalog: ModuleCatalogService) {}

  // ---------------- تحليل أثر التوقف وخطط التعافي ----------------

  private biaView(b: RiskContinuity) {
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    return { ...b, criticality: criticality(b.impacts, b.mtpdHours), testOverdue: !b.lastTestDate || b.lastTestDate < yearAgo };
  }

  async listContinuity(actor: OrgUser) {
    const rows = await this.db.getRepository(RiskContinuity).find({ where: { organizationId: actor.organizationId }, order: { code: 'ASC' } });
    const stage = await this.core.stageInfo(actor, 'continuity');
    return rows.map((b) => ({ ...this.biaView(b), ...stage(b) })).sort((a, b) => b.criticality.value - a.criticality.value || a.rtoHours - b.rtoHours);
  }

  async getContinuity(actor: OrgUser, id: string) {
    const b = await this.db.getRepository(RiskContinuity).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!b) throw new NotFoundException('النشاط غير موجود');
    const risks = b.riskIds.length ? await this.db.getRepository(RiskItem).find({ where: { id: In(b.riskIds) }, select: { id: true, code: true, title: true, residualScore: true } }) : [];
    const teams = await this.db.getRepository(RiskCrisisTeam).createQueryBuilder('t')
      .where('t.organization_id = :org AND t.continuity_ids @> :id', { org: actor.organizationId, id: JSON.stringify([id]) }).select(['t.id', 't.code', 't.name']).getMany();
    return { ...this.biaView(b), ...(await this.core.stageInfo(actor, 'continuity'))(b), risks, teams };
  }

  private async continuityData(em: EntityManager, org: string, dto: ContinuityDto) {
    if (dto.rtoHours > dto.mtpdHours) throw new BadRequestException('الوقت المستهدف للاستعادة يجب ألا يتجاوز أقصى فترة توقف محتملة');
    const ids = dto.riskIds ?? [];
    if (ids.length && (await em.getRepository(RiskItem).count({ where: { organizationId: org, id: In(ids) } })) !== new Set(ids).size) throw new BadRequestException('أحد المخاطر المختارة غير موجود');
    return {
      activity: dto.activity, unitName: dto.unitName ?? null, ownerName: dto.ownerName ?? null, description: dto.description ?? null,
      impacts: { financial: dto.impacts.financial, beneficiaries: dto.impacts.beneficiaries, reputation: dto.impacts.reputation, legal: dto.impacts.legal, operational: dto.impacts.operational },
      mtpdHours: dto.mtpdHours, rtoHours: dto.rtoHours, rpoHours: dto.rpoHours ?? null, minResources: dto.minResources ?? null,
      dependencies: dto.dependencies.map((d) => ({ kind: d.kind, name: d.name })), strategy: dto.strategy ?? null,
      steps: dto.steps.map((s) => ({ title: s.title, ownerName: s.ownerName ?? null, withinHours: s.withinHours ?? null })),
      riskIds: [...new Set(ids)], lastTestDate: dto.lastTestDate ?? null, lastTestResult: dto.lastTestResult ?? null,
    };
  }

  async saveContinuity(actor: OrgUser, dto: ContinuityDto, id?: string) {
    const org = actor.organizationId;
    const saved = await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskContinuity);
      const data = await this.continuityData(em, org, dto);
      if (id) {
        const b = await repo.findOne({ where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
        if (!b) throw new NotFoundException('النشاط غير موجود');
        assertEditable(b);
        // تسجيل نتيجة اختبار جديد لا يعيد الخطة للاعتماد، أما تغيير التحليل أو الخطة فيعيدها
        const onlyTest = JSON.stringify({ ...data, lastTestDate: null, lastTestResult: null }) === JSON.stringify({ ...(await this.continuityData(em, org, { ...b, impacts: b.impacts } as unknown as ContinuityDto)), lastTestDate: null, lastTestResult: null });
        if (!onlyTest) markEdited(b, actor.fullName);
        Object.assign(b, data);
        await repo.save(b);
        return id;
      }
      return (await repo.save(repo.create({ ...data, organizationId: org, code: await this.core.nextCode(em, org, 'BIA'), createdByName: actor.fullName }))).id;
    });
    return this.getContinuity(actor, saved);
  }

  async removeContinuity(actor: OrgUser, id: string) {
    const b = await this.db.getRepository(RiskContinuity).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!b) throw new NotFoundException('النشاط غير موجود');
    if (b.approvedAt) throw new ConflictException('خطة اعتُمدت مرة لا تُحذف');
    await this.db.getRepository(RiskContinuity).delete({ id });
  }

  submitContinuity(actor: OrgUser, id: string) {
    return this.core.transition(actor, 'continuity', (em) => em.getRepository(RiskContinuity), id, { submit: true }, {
      beforeSubmit: (b) => { if (!b.steps.length) throw new BadRequestException('أضف خطوات خطة التعافي قبل رفعها للاعتماد'); },
    });
  }

  decideContinuity(actor: OrgUser, id: string, decision: 'approve' | 'return' | 'reject', note?: string | null) {
    return this.core.transition(actor, 'continuity', (em) => em.getRepository(RiskContinuity), id, { decision, note });
  }

  // ---------------- فرق الأزمات ----------------

  async listTeams(actor: OrgUser) {
    const org = actor.organizationId;
    const [teams, open] = await Promise.all([
      this.db.getRepository(RiskCrisisTeam).find({ where: { organizationId: org }, order: { code: 'ASC' } }),
      this.db.getRepository(RiskCrisisEvent).createQueryBuilder('e').where('e.organization_id = :org AND e.closed_at IS NULL', { org }).getMany(),
    ]);
    const stage = await this.core.stageInfo(actor, 'crisis');
    return teams.map((t) => ({ ...t, ...stage(t), activeEvent: open.find((e) => e.teamId === t.id) ?? null }));
  }

  async getTeam(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const t = await this.db.getRepository(RiskCrisisTeam).findOne({ where: { id, organizationId: org } });
    if (!t) throw new NotFoundException('الفريق غير موجود');
    const [events, plans] = await Promise.all([
      this.db.getRepository(RiskCrisisEvent).find({ where: { organizationId: org, teamId: id }, order: { activatedAt: 'DESC' } }),
      t.continuityIds.length ? this.db.getRepository(RiskContinuity).find({ where: { id: In(t.continuityIds) }, select: { id: true, code: true, activity: true, rtoHours: true, status: true } }) : [],
    ]);
    const names = new Map(this.catalog.permissionCodes('organization').map((c) => [c, c]));
    const perms: { code: string; name: string }[] = t.systemPermissions.length ? await this.db.query('SELECT code, name FROM permissions WHERE code = ANY($1)', [t.systemPermissions]) : [];
    return {
      ...t, ...(await this.core.stageInfo(actor, 'crisis'))(t), plans,
      permissionNames: perms.filter((p) => names.has(p.code)),
      activeEvent: events.find((e) => !e.closedAt) ?? null, events,
    };
  }

  /** الصلاحيات المتاحة لاختيار صلاحيات الطوارئ (صلاحيات وحدات الشركة المفعلة) */
  async permissionOptions(actor: OrgUser) {
    const enabled = await this.catalog.enabledModuleCodes(actor.organizationId);
    const codes = this.catalog.permissionCodes('organization', enabled);
    return this.db.query(
      `SELECT p.code, p.name, m.name AS "moduleName" FROM permissions p JOIN erp_modules m ON m.code = p.module_code WHERE p.code = ANY($1) ORDER BY m.sequence, p.code`, [codes]);
  }

  private async teamData(em: EntityManager, actor: OrgUser, dto: CrisisTeamDto) {
    const org = actor.organizationId;
    if (!dto.members.length) throw new BadRequestException('أضف أعضاء الفريق');
    const userIds = dto.members.map((m) => m.userId).filter((x): x is string => !!x);
    if (new Set(userIds).size !== userIds.length) throw new BadRequestException('عضو مكرر في الفريق');
    if (userIds.length) {
      const rows: unknown[] = await em.query('SELECT id FROM users WHERE organization_id = $1 AND id = ANY($2)', [org, userIds]);
      if (rows.length !== userIds.length) throw new BadRequestException('أحد الأعضاء ليس من مستخدمي الشركة');
    }
    if (dto.systemPermissions.length && !userIds.length) throw new BadRequestException('صلاحيات النظام تُمنح لأعضاء من مستخدمي النظام، اختر الأعضاء من المستخدمين');
    // نفس قاعدة الأدوار: لا تُمنح صلاحية غير معروفة، ولا صلاحية لا يملكها من يحدد صلاحيات الفريق
    const enabled = await this.catalog.enabledModuleCodes(org);
    const allowed = new Set(this.catalog.permissionCodes('organization', enabled));
    const perms = [...new Set(dto.systemPermissions)];
    const unknown = perms.filter((c) => !allowed.has(c));
    if (unknown.length) throw new BadRequestException(`صلاحيات غير معروفة أو لوحدة غير مفعلة: ${unknown.join(', ')}`);
    if (!actor.isSuperadmin) {
      const missing = perms.filter((c) => !actor.permissions.includes(c));
      if (missing.length) throw new ForbiddenException(`لا يمكنك منح صلاحيات لا تملكها: ${missing.join(', ')}`);
    }
    const plans = dto.continuityIds ?? [];
    if (plans.length && (await em.getRepository(RiskContinuity).count({ where: { organizationId: org, id: In(plans) } })) !== new Set(plans).size) {
      throw new BadRequestException('إحدى خطط التعافي المختارة غير موجودة');
    }
    return {
      name: dto.name, kind: dto.kind, mandate: dto.mandate ?? null,
      members: dto.members.map((m) => ({ userId: m.userId ?? null, name: m.name, teamRole: m.teamRole, phone: m.phone ?? null, alternate: m.alternate ?? null })),
      authorities: dto.authorities.map((a) => ({ authority: a.authority, holder: a.holder, limit: a.limit ?? null })),
      systemPermissions: perms, playbook: dto.playbook.map((s) => ({ title: s.title, ownerName: s.ownerName ?? null, withinHours: s.withinHours ?? null })),
      communication: dto.communication ?? null, continuityIds: [...new Set(plans)],
    };
  }

  async saveTeam(actor: OrgUser, dto: CrisisTeamDto, id?: string) {
    const org = actor.organizationId;
    const saved = await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskCrisisTeam);
      const data = await this.teamData(em, actor, dto);
      if (id) {
        const t = await repo.findOne({ where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
        if (!t) throw new NotFoundException('الفريق غير موجود');
        assertEditable(t);
        if (await em.getRepository(RiskCrisisEvent).exists({ where: { teamId: id, closedAt: IsNull() } })) throw new ConflictException('الفريق مفعّل في أزمة قائمة، ولا يُعدّل حتى تنتهي');
        markEdited(t, actor.fullName);
        Object.assign(t, data);
        await repo.save(t);
        return id;
      }
      return (await repo.save(repo.create({ ...data, organizationId: org, code: await this.core.nextCode(em, org, 'CMT'), createdByName: actor.fullName }))).id;
    });
    return this.getTeam(actor, saved);
  }

  async removeTeam(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const t = await this.db.getRepository(RiskCrisisTeam).findOne({ where: { id, organizationId: org } });
    if (!t) throw new NotFoundException('الفريق غير موجود');
    if (await this.db.getRepository(RiskCrisisEvent).exists({ where: { teamId: id } })) throw new ConflictException('فريق فُعّل في أزمة سابقة لا يُحذف حفاظًا على السجل');
    await this.db.transaction(async (em) => {
      if (t.roleId) await em.query('DELETE FROM roles WHERE id = $1 AND organization_id = $2', [t.roleId, org]);
      await em.getRepository(RiskCrisisTeam).delete({ id });
    });
  }

  submitTeam(actor: OrgUser, id: string) {
    return this.core.transition(actor, 'crisis', (em) => em.getRepository(RiskCrisisTeam), id, { submit: true }, {
      beforeSubmit: (t) => {
        if (!t.authorities.length) throw new BadRequestException('حدد لائحة صلاحيات الفريق قبل رفعه للاعتماد');
        if (!t.members.some((m) => /قائد|رئيس/.test(m.teamRole))) throw new BadRequestException('حدد قائد الفريق بين الأعضاء');
      },
    });
  }

  decideTeam(actor: OrgUser, id: string, decision: 'approve' | 'return' | 'reject', note?: string | null) {
    return this.core.transition(actor, 'crisis', (em) => em.getRepository(RiskCrisisTeam), id, { decision, note });
  }

  /** دور النظام الخاص بالفريق، يُنشأ أو يُحدَّث بصلاحيات الطوارئ الحالية */
  private async syncRole(em: EntityManager, t: RiskCrisisTeam) {
    const name = `فريق الأزمة: ${t.code}`;
    let roleId = t.roleId;
    if (roleId && !(await em.query('SELECT 1 FROM roles WHERE id = $1', [roleId])).length) roleId = null;
    if (!roleId) {
      const [existing] = await em.query('SELECT id FROM roles WHERE organization_id = $1 AND name = $2', [t.organizationId, name]);
      roleId = existing?.id ?? (await em.query(
        `INSERT INTO roles (organization_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
        [t.organizationId, name, `يُسند تلقائيًا لأعضاء «${t.name}» أثناء تفعيل الأزمة فقط، ويُسحب عند إنهائها. لا تُسنده يدويًا.`]))[0].id;
      await em.getRepository(RiskCrisisTeam).update({ id: t.id }, { roleId });
    }
    await em.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    if (t.systemPermissions.length) {
      await em.query('INSERT INTO role_permissions (role_id, permission_code) SELECT $1, unnest($2::varchar[])', [roleId, t.systemPermissions]);
    }
    return roleId!;
  }

  async activate(actor: OrgUser, teamId: string, dto: CrisisActivateDto) {
    const org = actor.organizationId;
    const eventId = await this.db.transaction(async (em) => {
      const t = await em.getRepository(RiskCrisisTeam).findOne({ where: { id: teamId, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!t) throw new NotFoundException('الفريق غير موجود');
      if (t.status !== 'approved') throw new ConflictException('لا يُفعّل إلا فريق معتمد التشكيل والصلاحيات');
      if (await em.getRepository(RiskCrisisEvent).exists({ where: { teamId, closedAt: IsNull() } })) throw new ConflictException('الفريق مفعّل بالفعل في أزمة قائمة');
      if (dto.riskId && !(await em.getRepository(RiskItem).exists({ where: { id: dto.riskId, organizationId: org } }))) throw new BadRequestException('الخطر المرتبط غير موجود');
      const roleId = await this.syncRole(em, t);
      const memberIds = t.members.map((m) => m.userId).filter((x): x is string => !!x);
      const inserted: { user_id: string }[] = memberIds.length ? await em.query(
        `INSERT INTO user_roles (user_id, role_id) SELECT u, $1 FROM unnest($2::uuid[]) u
         WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = u AND role_id = $1) RETURNING user_id`, [roleId, memberIds]) : [];
      const now = new Date().toISOString();
      const ev = await em.getRepository(RiskCrisisEvent).save({
        organizationId: org, code: await this.core.nextCode(em, org, 'CRS'), teamId, title: dto.title, scenario: dto.scenario ?? null, severity: dto.severity,
        riskId: dto.riskId ?? null, grantedUserIds: inserted.map((r) => r.user_id), activatedAt: new Date(), activatedByName: actor.fullName,
        log: [{ at: now, byName: actor.fullName, text: `تفعيل الفريق ومنح ${inserted.length} عضوًا صلاحيات الطوارئ (${t.systemPermissions.length} صلاحية)` }],
      });
      // مهام الاستجابة من خطة إدارة الأزمة تُنشأ تلقائيًا بمواعيدها
      for (const s of t.playbook) {
        const member = t.members.find((m) => m.name === s.ownerName || m.teamRole === s.ownerName);
        const due = new Date(Date.now() + (s.withinHours ?? 24) * 3600000 + 3 * 3600000).toISOString().slice(0, 10);
        await em.getRepository(RiskTask).save({
          organizationId: org, sourceType: 'crisis', sourceId: ev.id, title: s.title, description: null, unitId: null, unitName: null,
          assigneeUserId: member?.userId ?? null, assigneeName: member?.name ?? s.ownerName ?? null, startDate: today(), dueDate: due, createdByName: actor.fullName,
        });
      }
      return ev.id;
    });
    return this.getEvent(actor, eventId);
  }

  async getEvent(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const e = await this.db.getRepository(RiskCrisisEvent).findOne({ where: { id, organizationId: org } });
    if (!e) throw new NotFoundException('حالة الأزمة غير موجودة');
    const team = await this.db.getRepository(RiskCrisisTeam).findOneByOrFail({ id: e.teamId });
    const tasks = (await this.db.getRepository(RiskTask).find({ where: { organizationId: org, sourceType: 'crisis', sourceId: id }, order: { dueDate: 'ASC' } }))
      .map((t) => ({ ...t, overdue: !['done', 'cancelled'].includes(t.status) && t.dueDate < today() }));
    return { ...e, team: { id: team.id, code: team.code, name: team.name, members: team.members, authorities: team.authorities }, tasks };
  }

  async addLog(actor: OrgUser, id: string, dto: CrisisLogDto) {
    const repo = this.db.getRepository(RiskCrisisEvent);
    const e = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!e) throw new NotFoundException('حالة الأزمة غير موجودة');
    if (e.closedAt) throw new ConflictException('حالة الأزمة منتهية');
    await repo.update({ id }, { log: [...e.log, { at: new Date().toISOString(), byName: actor.fullName, text: dto.text }] });
    return this.getEvent(actor, id);
  }

  /** إنهاء الأزمة: يسحب الصلاحيات الممنوحة بالتفعيل (دون المساس بأدوار كانت للأعضاء قبله) */
  async close(actor: OrgUser, id: string, dto: CrisisCloseDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const e = await em.getRepository(RiskCrisisEvent).findOne({ where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!e) throw new NotFoundException('حالة الأزمة غير موجودة');
      if (e.closedAt) throw new ConflictException('حالة الأزمة منتهية بالفعل');
      const t = await em.getRepository(RiskCrisisTeam).findOneByOrFail({ id: e.teamId });
      if (t.roleId && e.grantedUserIds.length) await em.query('DELETE FROM user_roles WHERE role_id = $1 AND user_id = ANY($2::uuid[])', [t.roleId, e.grantedUserIds]);
      await em.getRepository(RiskCrisisEvent).update({ id }, {
        closedAt: new Date(), closedByName: actor.fullName, lessons: dto.lessons,
        log: [...e.log, { at: new Date().toISOString(), byName: actor.fullName, text: 'إعلان انتهاء الأزمة وسحب صلاحيات الطوارئ' }],
      });
    });
    return this.getEvent(actor, id);
  }
}
