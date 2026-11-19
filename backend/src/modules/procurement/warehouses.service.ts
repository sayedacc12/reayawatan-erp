import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { LOCATION_KINDS, LOCATION_PURPOSE, PrLocation, PrWarehouse, WAREHOUSE_KINDS } from './entities/procurement.entity';
import { LocationDto, WarehouseDto } from './procurement.dto';
import { logEntry, ProcurementCore } from './procurement-core.service';

/** المستودعات ومواقع التخزين بداخلها (مناطق وممرات وأرفف وخانات) */
@Injectable()
export class WarehousesService {
  constructor(private readonly db: DataSource, private readonly core: ProcurementCore) {}

  async list(org: string) {
    await this.core.settings(org);
    const rows = await this.db.getRepository(PrWarehouse).find({ where: { organizationId: org }, order: { code: 'ASC' } });
    const [units, projects, counts] = await Promise.all([
      this.db.query('SELECT id, name FROM hr_units WHERE organization_id = $1', [org]).catch(() => []) as Promise<{ id: string; name: string }[]>,
      this.db.query('SELECT id, name FROM activities WHERE organization_id = $1 AND id = ANY($2)', [org, rows.map((w) => w.projectId).filter(Boolean)]) as Promise<{ id: string; name: string }[]>,
      this.db.query('SELECT warehouse_id, COUNT(*)::int AS n FROM pr_locations WHERE organization_id = $1 GROUP BY warehouse_id', [org]) as Promise<{ warehouse_id: string; n: number }[]>,
    ]);
    const unit = new Map(units.map((u) => [u.id, u.name]));
    const project = new Map(projects.map((p) => [p.id, p.name]));
    const locs = new Map(counts.map((c) => [c.warehouse_id, c.n]));
    const users = await this.core.userNames(org, rows.flatMap((w) => w.keeperIds));
    const acc = await this.core.accountMap(org, rows.map((w) => w.glAccountId));
    const byId = new Map(rows.map((w) => [w.id, w]));
    return rows.map((w) => ({
      ...w, kindLabel: WAREHOUSE_KINDS[w.kind], parentName: w.parentId ? byId.get(w.parentId)?.name ?? null : null,
      unitName: w.unitId ? unit.get(w.unitId) ?? null : null, projectName: w.projectId ? project.get(w.projectId) ?? null : null,
      keepers: w.keeperIds.map((id) => ({ id, name: users.get(id) ?? '—' })), glAccount: acc.get(w.glAccountId ?? '') ?? null,
      locations: locs.get(w.id) ?? 0, children: rows.filter((x) => x.parentId === w.id).length,
    }));
  }

  async get(org: string, id: string) {
    const w = (await this.list(org)).find((x) => x.id === id);
    if (!w) throw new NotFoundException('المستودع غير موجود');
    const locations = await this.db.getRepository(PrLocation).find({ where: { warehouseId: id }, order: { sortOrder: 'ASC', code: 'ASC' } });
    return {
      ...w,
      locationsList: locations.map((l) => ({ ...l, kindLabel: LOCATION_KINDS[l.kind], purposeLabel: LOCATION_PURPOSE[l.purpose], label: `${w.code}/${l.code}` })),
    };
  }

  private async check(org: string, dto: WarehouseDto, id?: string) {
    const s = await this.core.settings(org);
    const repo = this.db.getRepository(PrWarehouse);
    if (dto.code) {
      const dup = await repo.findOne({ where: { organizationId: org, code: dto.code } });
      if (dup && dup.id !== id) throw new ConflictException(`الرمز ${dto.code} مستخدم لمستودع «${dup.name}»`);
    }
    if (dto.kind === 'main' && dto.parentId) throw new BadRequestException('المستودع الرئيسي لا يتبع مستودعًا آخر');
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('المستودع لا يتبع نفسه');
      const p = await repo.findOne({ where: { id: dto.parentId, organizationId: org } });
      if (!p) throw new BadRequestException('المستودع الرئيسي غير موجود');
      if (p.parentId === id) throw new BadRequestException('لا يتبع المستودع أحد فروعه');
    }
    if (dto.unitId) {
      const [u] = await this.db.query('SELECT id FROM hr_units WHERE organization_id = $1 AND id = $2', [org, dto.unitId]).catch(() => []);
      if (!u) throw new BadRequestException('الإدارة أو الفرع غير موجود في الهيكل التنظيمي');
    }
    if (dto.projectId) {
      const [p] = await this.db.query('SELECT a.id FROM activities a JOIN project_profiles p ON p.activity_id = a.id WHERE a.organization_id = $1 AND a.id = $2', [org, dto.projectId]).catch(() => []);
      if (!p) throw new BadRequestException('المشروع غير موجود');
    }
    const keepers = [...new Set(dto.keeperIds ?? [])];
    if (keepers.length) {
      const names = await this.core.userNames(org, keepers);
      if (names.size !== keepers.length) throw new BadRequestException('أحد أمناء المستودع غير موجود في مستخدمي الجمعية');
    }
    await this.core.account(org, dto.glAccountId, 'assets', 'حساب المخزون');
    if (s.accountLevel === 'warehouse' && !dto.glAccountId) {
      throw new BadRequestException('حسابات المخزون محددة على مستوى المستودع في الإعدادات، فاختر حساب المخزون لهذا المستودع');
    }
    return keepers;
  }

  private fields(dto: WarehouseDto, keepers: string[]) {
    return {
      name: dto.name.trim(), kind: dto.kind, parentId: dto.kind === 'main' ? null : dto.parentId ?? null, unitId: dto.unitId ?? null, projectId: dto.projectId ?? null,
      city: dto.city ?? null, address: dto.address ?? null, keeperIds: keepers, glAccountId: dto.glAccountId ?? null, capacity: dto.capacity ?? null, notes: dto.notes ?? null,
    };
  }

  async create(a: OrgUser, dto: WarehouseDto) {
    const org = a.organizationId;
    const keepers = await this.check(org, dto);
    const id = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pr-wh:${org}`]);
      let code = dto.code;
      if (!code) {
        const [m] = await em.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '^WH-', ''), '')::int), 0) + 1 AS n FROM pr_warehouses WHERE organization_id = $1 AND code ~ '^WH-[0-9]+$'`, [org]);
        code = `WH-${String(m.n).padStart(2, '0')}`;
      }
      const w = await em.getRepository(PrWarehouse).save(em.create(PrWarehouse, {
        organizationId: org, code, ...this.fields(dto, keepers), isActive: dto.isActive ?? true, log: [logEntry('إنشاء المستودع', a.fullName)],
      }));
      return w.id;
    });
    return this.get(org, id);
  }

  async update(a: OrgUser, id: string, dto: WarehouseDto) {
    const org = a.organizationId;
    const w = await this.db.getRepository(PrWarehouse).findOne({ where: { id, organizationId: org } });
    if (!w) throw new NotFoundException('المستودع غير موجود');
    const keepers = await this.check(org, { ...dto, code: dto.code ?? w.code }, id);
    if (dto.isActive === false && w.isActive && (await this.db.getRepository(PrWarehouse).exists({ where: { organizationId: org, parentId: id, isActive: true } }))) {
      throw new ConflictException('أوقف المستودعات التابعة لهذا المستودع أولًا');
    }
    const note = [w.name !== dto.name.trim() ? 'الاسم' : null, w.glAccountId !== (dto.glAccountId ?? null) ? 'حساب المخزون' : null,
      JSON.stringify(w.keeperIds) !== JSON.stringify(keepers) ? 'أمناء المستودع' : null, dto.isActive !== undefined && dto.isActive !== w.isActive ? (dto.isActive ? 'تفعيل' : 'إيقاف') : null]
      .filter(Boolean).join('، ');
    await this.db.getRepository(PrWarehouse).update({ id }, {
      ...this.fields(dto, keepers), code: dto.code ?? w.code, isActive: dto.isActive ?? w.isActive, log: [...w.log, logEntry('تعديل المستودع', a.fullName, note || null)],
    });
    return this.get(org, id);
  }

  // ---------------- مواقع التخزين ----------------

  private async checkLocation(org: string, warehouseId: string, dto: LocationDto, id?: string) {
    const w = await this.db.getRepository(PrWarehouse).findOne({ where: { id: warehouseId, organizationId: org } });
    if (!w) throw new NotFoundException('المستودع غير موجود');
    const repo = this.db.getRepository(PrLocation);
    const dup = await repo.findOne({ where: { warehouseId, code: dto.code } });
    if (dup && dup.id !== id) throw new ConflictException(`الرمز ${dto.code} مستخدم لموقع «${dup.name}» في هذا المستودع`);
    if (dto.parentId) {
      const all = await repo.find({ where: { warehouseId } });
      const parent = all.find((l) => l.id === dto.parentId);
      if (!parent) throw new BadRequestException('الموقع الأعلى غير موجود في هذا المستودع');
      for (let p: PrLocation | undefined = parent; p; p = all.find((l) => l.id === p!.parentId)) {
        if (p.id === id) throw new BadRequestException('لا ينتقل الموقع تحت نفسه أو تحت أحد فروعه');
      }
    }
    return w;
  }

  async createLocation(a: OrgUser, warehouseId: string, dto: LocationDto) {
    const org = a.organizationId;
    await this.checkLocation(org, warehouseId, dto);
    const [m] = await this.db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pr_locations WHERE warehouse_id = $1', [warehouseId]);
    await this.db.getRepository(PrLocation).insert({
      organizationId: org, warehouseId, parentId: dto.parentId ?? null, code: dto.code, name: dto.name.trim(), kind: dto.kind, purpose: dto.purpose,
      capacity: dto.capacity ?? null, sortOrder: Number(m.n), isActive: dto.isActive ?? true,
    });
    return this.get(org, warehouseId);
  }

  async updateLocation(a: OrgUser, warehouseId: string, id: string, dto: LocationDto) {
    const org = a.organizationId;
    const l = await this.db.getRepository(PrLocation).findOne({ where: { id, warehouseId, organizationId: org } });
    if (!l) throw new NotFoundException('الموقع غير موجود');
    await this.checkLocation(org, warehouseId, dto, id);
    await this.db.getRepository(PrLocation).update({ id }, {
      parentId: dto.parentId ?? null, code: dto.code, name: dto.name.trim(), kind: dto.kind, purpose: dto.purpose, capacity: dto.capacity ?? null, isActive: dto.isActive ?? l.isActive,
    });
    return this.get(org, warehouseId);
  }

  async removeLocation(a: OrgUser, warehouseId: string, id: string) {
    const org = a.organizationId;
    const l = await this.db.getRepository(PrLocation).findOne({ where: { id, warehouseId, organizationId: org } });
    if (!l) throw new NotFoundException('الموقع غير موجود');
    if (await this.db.getRepository(PrLocation).exists({ where: { parentId: id } })) throw new ConflictException('احذف المواقع التي تحته أولًا');
    await this.db.getRepository(PrLocation).delete({ id });
    return this.get(org, warehouseId);
  }
}
