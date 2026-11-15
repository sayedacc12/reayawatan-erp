import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { validateDonorData } from './donor-fields';
import { DonorDto, ListDonorsQuery } from './donors.dto';
import { Donor, DonorLevel, SupportManager } from './entities';
import { FundraisingSettingsService } from './settings.service';

type Query = (sql: string, params: unknown[]) => Promise<unknown[]>;

/** سجل الداعمين */
@Injectable()
export class DonorsService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Donor) private readonly donors: Repository<Donor>,
    private readonly settings: FundraisingSettingsService,
  ) {}

  async list(actor: OrgUser, q: ListDonorsQuery) {
    const page = q.page ?? 1;
    const size = q.pageSize ?? 25;
    const conds = ['d.organization_id = $1'];
    const params: unknown[] = [actor.organizationId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      conds.push(sql.replace('?', `$${params.length}`));
    };
    const term = q.search?.trim();
    if (term) {
      params.push(`%${term}%`);
      const i = params.length;
      const byNo = /^\d{1,9}$/.test(term) ? ` OR d.donor_no = ${Number(term)}` : '';
      conds.push(`(d.name ILIKE $${i} OR d.phone ILIKE $${i} OR d.email ILIKE $${i} OR d.identifier ILIKE $${i}${byNo})`);
    }
    if (q.levelId) add('d.level_id = ?', q.levelId);
    if (q.supportManagerId) add('d.support_manager_id = ?', q.supportManagerId);
    if (q.type) add('d.type = ?', q.type);
    if (q.active) add('d.is_active = ?', q.active === 'true');
    const where = conds.join(' AND ');
    const [{ total }] = await this.db.query(`SELECT COUNT(*)::int AS total FROM fundraising_donors d WHERE ${where}`, params);
    const rows = await this.db.query(
      `SELECT d.id, d.donor_no AS "donorNo", d.name, d.type, d.phone, d.email, d.city, d.is_active AS "isActive",
              l.id AS "levelId", l.name AS "levelName", l.color AS "levelColor", m.name AS "managerName",
              COALESCE(t.total, 0)::float AS "totalDonated", COALESCE(t.count, 0)::int AS "opportunityCount", t.last AS "lastDonation"
         FROM fundraising_donors d
         LEFT JOIN fundraising_donor_levels l ON l.id = d.level_id
         LEFT JOIN fundraising_support_managers m ON m.id = d.support_manager_id
         LEFT JOIN LATERAL (
           SELECT SUM(o.total_amount) AS total, COUNT(*) AS count, MAX(o.opportunity_date) AS last
             FROM fundraising_opportunities o WHERE o.donor_id = d.id AND o.status = 'approved'
         ) t ON true
        WHERE ${where}
        ORDER BY d.donor_no DESC
        LIMIT ${size} OFFSET ${(page - 1) * size}`,
      params,
    );
    return { items: rows, total, page, pageSize: size };
  }

  async get(actor: OrgUser, id: string) {
    const d = await this.donors.findOne({ where: { id, organizationId: actor.organizationId }, relations: { level: true, supportManager: true } });
    if (!d) throw new NotFoundException('الداعم غير موجود');
    const org = actor.organizationId;
    const [opportunities, batches, [totals], general] = await Promise.all([
      this.db.query(
        `SELECT id, opportunity_no AS "opportunityNo", kind, status, opportunity_date AS date, total_amount::float AS "totalAmount",
                collected_amount::float AS "collectedAmount", is_zakat AS "isZakat", receipt_no AS "receiptNo"
           FROM fundraising_opportunities WHERE organization_id = $1 AND donor_id = $2 ORDER BY opportunity_no DESC`,
        [org, id],
      ),
      this.db.query(
        `SELECT b.id, b.batch_no AS "batchNo", b.target_kind AS "targetKind", b.target_name AS "targetName", b.status,
                b.amount::float AS amount, b.reserved_amount::float AS reserved, b.spent_amount::float AS spent,
                b.transferred_amount::float AS transferred, o.opportunity_no AS "opportunityNo", b.opportunity_id AS "opportunityId"
           FROM fundraising_batches b JOIN fundraising_opportunities o ON o.id = b.opportunity_id
          WHERE b.organization_id = $1 AND b.donor_id = $2 AND b.status <> 'cancelled' ORDER BY b.batch_no DESC`,
        [org, id],
      ),
      this.db.query(
        `SELECT COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved'), 0)::float AS approved,
                COALESCE(SUM(total_amount - collected_amount) FILTER (WHERE status = 'approved' AND kind = 'pledge'), 0)::float AS "pledgeOutstanding",
                COUNT(*) FILTER (WHERE status IN ('in_progress', 'returned'))::int AS pending
           FROM fundraising_opportunities WHERE organization_id = $1 AND donor_id = $2`,
        [org, id],
      ),
      this.settings.general(org),
    ]);
    const { level, supportManager, ...rest } = d;
    return {
      ...rest,
      levelName: level?.name ?? null, levelColor: level?.color ?? null, managerName: supportManager?.name ?? null,
      fields: general.donorFields, opportunities, batches, totals,
    };
  }

  async create(actor: OrgUser, dto: DonorDto) {
    const general = await this.settings.general(actor.organizationId);
    await this.checkRefs(actor, dto);
    const customData = validateDonorData(general.donorFields, dto.customData);
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`donors:${actor.organizationId}`]);
      await this.dupCheck((s, p) => em.query(s, p), actor.organizationId, dto);
      const [{ next }] = await em.query('SELECT COALESCE(MAX(donor_no), 0) + 1 AS next FROM fundraising_donors WHERE organization_id = $1', [actor.organizationId]);
      return em.save(em.create(Donor, {
        ...dto, customData, organizationId: actor.organizationId, donorNo: Number(next), createdBy: actor.id, isActive: dto.isActive ?? true,
      }));
    });
  }

  async update(actor: OrgUser, id: string, dto: DonorDto) {
    const d = await this.donors.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!d) throw new NotFoundException('الداعم غير موجود');
    const general = await this.settings.general(actor.organizationId);
    await this.checkRefs(actor, dto);
    await this.dupCheck((s, p) => this.db.query(s, p), actor.organizationId, dto, id);
    const customData = validateDonorData(general.donorFields, dto.customData, d.customData);
    Object.assign(d, { ...dto, customData });
    return this.donors.save(d);
  }

  async remove(actor: OrgUser, id: string) {
    const d = await this.donors.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!d) throw new NotFoundException('الداعم غير موجود');
    const [used] = await this.db.query('SELECT 1 FROM fundraising_opportunities WHERE donor_id = $1 LIMIT 1', [id]);
    if (used) throw new ConflictException('للداعم فرص تبرع مسجلة، لذا أوقفه بدلًا من حذفه');
    await this.donors.delete({ id });
  }

  private async checkRefs(actor: OrgUser, dto: DonorDto) {
    const org = actor.organizationId;
    if (dto.levelId && !(await this.db.getRepository(DonorLevel).exists({ where: { id: dto.levelId, organizationId: org } }))) {
      throw new BadRequestException('المستوى غير موجود');
    }
    if (dto.supportManagerId && !(await this.db.getRepository(SupportManager).exists({ where: { id: dto.supportManagerId, organizationId: org } }))) {
      throw new BadRequestException('مدير الدعم غير موجود');
    }
  }

  private async dupCheck(query: Query, org: string, dto: DonorDto, id?: string) {
    if (!dto.identifier) return;
    const [dup] = (await query(
      'SELECT donor_no FROM fundraising_donors WHERE organization_id = $1 AND identifier = $2 AND id <> $3',
      [org, dto.identifier, id ?? '00000000-0000-0000-0000-000000000000'],
    )) as { donor_no: number }[];
    if (dup) throw new ConflictException(`رقم الهوية أو السجل مسجل لداعم آخر (رقم ${dup.donor_no})`);
  }
}
