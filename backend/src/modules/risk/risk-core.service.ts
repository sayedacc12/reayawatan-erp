import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import {
  RiskGuideEntry, RiskMethodology, RiskMethodologyVersion, RiskPolicyVersion, RiskSettings,
} from './entities/risk.entity';
import { canDecide, Decider, validateConfig, WfRecord, wfDecide, wfSubmit } from './risk-calc';
import {
  defaultConfig, defaultMethodologies, defaultPolicy, defaultRiskLibrary, defaultTerms, mergeConfig, RiskConfig, WF_PROCESSES, WfProcess,
} from './risk-defaults';
import { GuideEntryDto, MethodologyDto, MethodologyVersionDto, NewMethodologyDto, PolicyDto } from './risk.dto';
import { RISK_PERMISSIONS as P } from './risk.manifest';

/** اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

/** صلاحية القرار في مراحل اعتماد كل إجراء */
export const APPROVE_PERMISSION: Record<WfProcess, string> = {
  risk: P.approveRegister, analysis: P.approveRegister, continuity: P.approveRegister, crisis: P.approveRegister,
  change: P.approveChange, compliance: P.approveCompliance, procedure: P.approveProcedures,
};

/** الإعدادات والترقيم ومحرك الاعتماد والمراجع (اللائحة والمنهجيات والدليل): مشتركة بين خدمات الوحدة */
@Injectable()
export class RiskCore {
  constructor(private readonly db: DataSource) {}

  async settings(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(RiskSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return s;
  }

  async config(org: string, em?: EntityManager): Promise<RiskConfig> {
    return mergeConfig((await this.settings(org, em)).config);
  }

  async getConfig(actor: OrgUser) {
    return { config: await this.config(actor.organizationId), defaults: defaultConfig() };
  }

  async saveConfig(actor: OrgUser, input: Record<string, unknown>) {
    const cfg = mergeConfig(input as Partial<RiskConfig>);
    cfg.levels = [...cfg.levels].sort((a, b) => a.min - b.min);
    cfg.appetite = Number(cfg.appetite);
    validateConfig(cfg);
    const roleIds = WF_PROCESSES.flatMap((k) => cfg.workflows[k].map((s) => s.roleId)).filter((x): x is string => !!x);
    if (roleIds.length) {
      const rows: unknown[] = await this.db.query('SELECT id FROM roles WHERE organization_id = $1 AND id = ANY($2)', [actor.organizationId, [...new Set(roleIds)]]);
      if (rows.length !== new Set(roleIds).size) throw new BadRequestException('أحد الأدوار المختارة في مراحل الاعتماد غير موجود');
    }
    for (const k of WF_PROCESSES) cfg.workflows[k] = cfg.workflows[k].map((s) => ({ name: s.name.trim(), roleId: s.roleId || null }));
    await this.settings(actor.organizationId);
    await this.db.getRepository(RiskSettings).update({ organizationId: actor.organizationId }, { config: cfg });
    return this.getConfig(actor);
  }

  /** الرقم التالي لنوع (RSK-001 ...) بقفل على صف الإعدادات */
  async nextCode(em: EntityManager, org: string, prefix: string) {
    await this.settings(org, em);
    const res = await em.query(
      `UPDATE risk_settings SET counters = jsonb_set(counters, ARRAY[$2::text], to_jsonb(COALESCE((counters->>$2)::int, 0) + 1))
       WHERE organization_id = $1 RETURNING (counters->>$2)::int AS n`, [org, prefix]);
    // في PostgreSQL ترجع استعلامات UPDATE بالشكل [rows, count]
    const row = (Array.isArray(res[0]) ? res[0] : res)[0];
    return `${prefix}-${String(row.n).padStart(3, '0')}`;
  }

  // ---------------- محرك الاعتماد ----------------

  private async roleIds(actor: OrgUser) {
    const rows: { role_id: string }[] = await this.db.query('SELECT role_id FROM user_roles WHERE user_id = $1', [actor.id]);
    return new Set(rows.map((r) => r.role_id));
  }

  async decider(actor: OrgUser, process: WfProcess): Promise<Decider> {
    return {
      name: actor.fullName, isSuperadmin: actor.isSuperadmin, hasPermission: actor.permissions.includes(APPROVE_PERMISSION[process]),
      roleIds: await this.roleIds(actor),
    };
  }

  /** رفع للاعتماد أو قرار على عنصر من أي نوع، داخل معاملة، ثم دالة اختيارية بعد الاعتماد النهائي */
  async transition<T extends WfRecord & ObjectLiteral & { id: string; organizationId: string }>(
    actor: OrgUser, process: WfProcess, repoOf: (em: EntityManager) => Repository<T>, id: string,
    op: { submit: true } | { decision: 'approve' | 'return' | 'reject'; note?: string | null },
    hooks: { beforeSubmit?: (r: T, em: EntityManager) => Promise<void> | void; afterApprove?: (r: T, em: EntityManager) => Promise<void> } = {},
  ) {
    const d = 'submit' in op ? null : await this.decider(actor, process);
    return this.db.transaction(async (em) => {
      const repo = repoOf(em);
      const r = await repo.findOne({ where: { id, organizationId: actor.organizationId } as never, lock: { mode: 'pessimistic_write' } });
      if (!r) throw new NotFoundException('العنصر غير موجود');
      const stages = (await this.config(actor.organizationId, em)).workflows[process];
      if ('submit' in op) {
        await hooks.beforeSubmit?.(r, em);
        wfSubmit(r, stages, actor.fullName);
      } else wfDecide(r, stages, d!, op.decision, op.note ?? null);
      await repo.save(r);
      if (r.status === 'approved' && hooks.afterApprove) await hooks.afterApprove(r, em);
      return r;
    });
  }

  /** معلومات المرحلة الحالية للعرض، وهل المستخدم الحالي يقرر فيها */
  async stageInfo(actor: OrgUser, process: WfProcess, cfg?: RiskConfig) {
    const c = cfg ?? (await this.config(actor.organizationId));
    const d = await this.decider(actor, process);
    const stages = c.workflows[process];
    return (r: WfRecord) => ({
      stageName: r.status === 'in_review' && r.stageIndex !== null ? stages[r.stageIndex]?.name ?? null : null,
      stages: stages.map((s) => s.name),
      canDecide: canDecide(stages, r, d),
    });
  }

  // ---------------- القوائم المساعدة ----------------

  async lookups(actor: OrgUser) {
    const org = actor.organizationId;
    const [units, users, roles] = await Promise.all([
      this.db.query('SELECT id, name, level FROM hr_units WHERE organization_id = $1 ORDER BY level, sort_order, name', [org]).catch(() => []),
      this.db.query('SELECT id, full_name AS "fullName" FROM users WHERE organization_id = $1 AND is_active ORDER BY full_name', [org]),
      this.db.query('SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name', [org]),
    ]);
    return { units, users, roles };
  }

  async unitName(org: string, unitId: string | null | undefined, em: EntityManager = this.db.manager) {
    if (!unitId) return null;
    const [u] = await em.query('SELECT name FROM hr_units WHERE organization_id = $1 AND id = $2', [org, unitId]).catch(() => []);
    if (!u) throw new BadRequestException('الوحدة المختارة غير موجودة في الهيكل التنظيمي');
    return u.name as string;
  }

  // ---------------- اللائحة ----------------

  async getPolicy(actor: OrgUser) {
    const rows = await this.db.getRepository(RiskPolicyVersion).find({ where: { organizationId: actor.organizationId }, order: { version: 'DESC' } });
    const meta = (r: RiskPolicyVersion) => ({
      version: r.version, effectiveDate: r.effectiveDate, approvedBy: r.approvedBy, note: r.note, createdByName: r.createdByName,
      createdAt: r.createdAt, changedSections: r.changedSections,
    });
    return {
      sections: rows[0]?.sections ?? defaultPolicy(),
      current: rows[0] ? meta(rows[0]) : null,
      history: rows.map(meta),
    };
  }

  async policyVersion(actor: OrgUser, version: number) {
    const r = await this.db.getRepository(RiskPolicyVersion).findOne({ where: { organizationId: actor.organizationId, version } });
    if (!r) throw new NotFoundException('الإصدار غير موجود');
    return r;
  }

  async savePolicy(actor: OrgUser, dto: PolicyDto) {
    if (!dto.sections.length) throw new BadRequestException('اللائحة بلا أبواب');
    const keys = dto.sections.map((s) => s.key);
    if (new Set(keys).size !== keys.length) throw new BadRequestException('رموز أبواب اللائحة مكررة');
    const repo = this.db.getRepository(RiskPolicyVersion);
    const last = await repo.findOne({ where: { organizationId: actor.organizationId }, order: { version: 'DESC' } });
    const prev = last?.sections ?? [];
    const changed: RiskPolicyVersion['changedSections'] = [];
    for (const s of dto.sections) {
      const p = prev.find((x) => x.key === s.key);
      if (!p) changed.push({ title: s.title, change: 'added' });
      else if (p.title !== s.title || p.body.trim() !== s.body.trim()) changed.push({ title: s.title, change: 'modified' });
    }
    for (const p of prev) if (!keys.includes(p.key)) changed.push({ title: p.title, change: 'removed' });
    if (last && !changed.length) throw new BadRequestException('لا يوجد تعديل على اللائحة لحفظه كإصدار جديد');
    if (last && dto.effectiveDate < last.effectiveDate) throw new BadRequestException('تاريخ سريان الإصدار الجديد قبل الإصدار السابق');
    await repo.save(repo.create({
      organizationId: actor.organizationId, version: (last?.version ?? 0) + 1, sections: dto.sections.map((s) => ({ key: s.key, title: s.title, body: s.body.trim() })),
      changedSections: changed, note: dto.note, effectiveDate: dto.effectiveDate, approvedBy: dto.approvedBy ?? null, createdByName: actor.fullName,
    }));
    return this.getPolicy(actor);
  }

  // ---------------- سجل المنهجيات ----------------

  async listMethodologies(actor: OrgUser) {
    const org = actor.organizationId;
    const items = await this.db.getRepository(RiskMethodology).find({ where: { organizationId: org }, order: { code: 'ASC' } });
    const versions = await this.db.getRepository(RiskMethodologyVersion).find({ where: { organizationId: org }, order: { version: 'DESC' } });
    return {
      installed: items.length > 0,
      items: items.map((m) => {
        const vs = versions.filter((v) => v.methodologyId === m.id);
        return {
          ...m, current: vs[0] ?? null,
          history: vs.map((v) => ({ id: v.id, version: v.version, effectiveDate: v.effectiveDate, approvedBy: v.approvedBy, note: v.note, createdByName: v.createdByName, createdAt: v.createdAt })),
        };
      }),
    };
  }

  async methodologyVersion(actor: OrgUser, id: string) {
    const v = await this.db.getRepository(RiskMethodologyVersion).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!v) throw new NotFoundException('الإصدار غير موجود');
    return v;
  }

  /** المنهجية السارية في تاريخ معين (للرجوع عند الحاجة) */
  async methodologyAt(actor: OrgUser, methodologyId: string, date: string) {
    const v = await this.db.getRepository(RiskMethodologyVersion).createQueryBuilder('v')
      .where('v.organization_id = :org AND v.methodology_id = :id AND v.effective_date <= :date', { org: actor.organizationId, id: methodologyId, date })
      .orderBy('v.effective_date', 'DESC').addOrderBy('v.version', 'DESC').getOne();
    if (!v) throw new NotFoundException('لم يكن للمنهجية إصدار ساري في هذا التاريخ');
    return v;
  }

  async installMethodologies(actor: OrgUser, effectiveDate = today()) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      if (await em.getRepository(RiskMethodology).exists({ where: { organizationId: org } })) throw new ConflictException('سجل المنهجيات منصّب بالفعل');
      for (const m of defaultMethodologies()) {
        const row = await em.getRepository(RiskMethodology).save({ organizationId: org, code: m.code, name: m.name, domain: m.domain, reference: m.reference });
        await em.getRepository(RiskMethodologyVersion).save({
          organizationId: org, methodologyId: row.id, version: 1, body: m.body, effectiveDate, approvedBy: null,
          note: 'الإصدار الأول (المنهجية المقترحة من النظام)', createdByName: actor.fullName,
        });
      }
    });
    return this.listMethodologies(actor);
  }

  async createMethodology(actor: OrgUser, dto: NewMethodologyDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const n = (await em.getRepository(RiskMethodology).count({ where: { organizationId: org } })) + 1;
      const row = await em.getRepository(RiskMethodology).save({
        organizationId: org, code: `MTH-${String(n).padStart(2, '0')}`, name: dto.name, domain: dto.domain, reference: dto.reference ?? null,
      });
      await em.getRepository(RiskMethodologyVersion).save({
        organizationId: org, methodologyId: row.id, version: 1, body: dto.body.trim(), effectiveDate: dto.effectiveDate, approvedBy: dto.approvedBy ?? null,
        note: 'الإصدار الأول', createdByName: actor.fullName,
      });
    });
    return this.listMethodologies(actor);
  }

  async updateMethodology(actor: OrgUser, id: string, dto: MethodologyDto) {
    const repo = this.db.getRepository(RiskMethodology);
    const m = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!m) throw new NotFoundException('المنهجية غير موجودة');
    await repo.update({ id }, { name: dto.name, domain: dto.domain, reference: dto.reference ?? null, isActive: dto.isActive ?? m.isActive });
    return this.listMethodologies(actor);
  }

  /** إصدار جديد للمنهجية: النص الكامل بتاريخ سريان وجهة اعتماد وملخص للتعديل */
  async newMethodologyVersion(actor: OrgUser, id: string, dto: MethodologyVersionDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const m = await em.getRepository(RiskMethodology).findOne({ where: { id, organizationId: org } });
      if (!m) throw new NotFoundException('المنهجية غير موجودة');
      const last = await em.getRepository(RiskMethodologyVersion).findOne({ where: { methodologyId: id }, order: { version: 'DESC' }, lock: { mode: 'pessimistic_write' } });
      if (last && last.body.trim() === dto.body.trim()) throw new BadRequestException('لم يتغير نص المنهجية');
      if (last && dto.effectiveDate < last.effectiveDate) throw new BadRequestException('تاريخ سريان الإصدار الجديد قبل الإصدار السابق');
      await em.getRepository(RiskMethodologyVersion).save({
        organizationId: org, methodologyId: id, version: (last?.version ?? 0) + 1, body: dto.body.trim(), effectiveDate: dto.effectiveDate,
        approvedBy: dto.approvedBy ?? null, note: dto.note, createdByName: actor.fullName,
      });
    });
    return this.listMethodologies(actor);
  }

  // ---------------- دليل المصطلحات والمخاطر ----------------

  async guide(actor: OrgUser) {
    const org = actor.organizationId;
    const s = await this.settings(org);
    if (!s.guideInstalled) {
      // ننصّب الدليل المقترح أول مرة فقط، فما تحذفه الجمعية لا يعود
      await this.db.transaction(async (em) => {
        const locked = await em.getRepository(RiskSettings).findOne({ where: { organizationId: org }, lock: { mode: 'pessimistic_write' } });
        if (locked?.guideInstalled) return;
        const rows = [...defaultTerms(), ...defaultRiskLibrary()].map((e, i) => ({ ...e, organizationId: org, sortOrder: i }));
        await em.getRepository(RiskGuideEntry).insert(rows);
        await em.getRepository(RiskSettings).update({ organizationId: org }, { guideInstalled: true });
      });
    }
    return this.db.getRepository(RiskGuideEntry).find({ where: { organizationId: org }, order: { kind: 'ASC', sortOrder: 'ASC', title: 'ASC' } });
  }

  async saveGuideEntry(actor: OrgUser, dto: GuideEntryDto, id?: string) {
    const repo = this.db.getRepository(RiskGuideEntry);
    const data = { kind: dto.kind, title: dto.title, titleEn: dto.titleEn ?? null, category: dto.category, body: dto.body, details: dto.kind === 'risk' ? dto.details ?? {} : {} };
    if (id) {
      const e = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
      if (!e) throw new NotFoundException('العنصر غير موجود');
      await repo.update({ id }, data as never);
      return repo.findOneByOrFail({ id });
    }
    const max = await repo.maximum('sortOrder', { organizationId: actor.organizationId });
    return repo.save(repo.create({ ...data, organizationId: actor.organizationId, sortOrder: (max ?? 0) + 1 } as never));
  }

  async removeGuideEntry(actor: OrgUser, id: string) {
    const r = await this.db.getRepository(RiskGuideEntry).delete({ id, organizationId: actor.organizationId });
    if (!r.affected) throw new NotFoundException('العنصر غير موجود');
  }
}
