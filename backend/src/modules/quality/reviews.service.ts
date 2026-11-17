import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { QmsReview, ReviewOutput } from './entities/quality.entity';
import { ReviewDto } from './quality.dto';
import { QmsCore, shortId, today } from './quality-core.service';
import { ReportsService } from './reports.service';

export const OUTPUT_TYPE_LABELS: Record<string, string> = { improvement: 'فرصة تحسين', change: 'تغيير في النظام', resources: 'احتياج موارد' };

/** مراجعة الإدارة (9.3): المدخلات تُعبأ من النظام، والمخرجات قرارات بمسؤول وموعد تُتابع حتى التنفيذ */
@Injectable()
export class ReviewsService {
  constructor(private readonly db: DataSource, private readonly core: QmsCore, private readonly reports: ReportsService) {}

  private get repo() {
    return this.db.getRepository(QmsReview);
  }

  private row(r: QmsReview) {
    const t = today();
    return {
      ...r, code: `MR-${r.meetingDate.slice(0, 4)}-${String(r.reviewNo).padStart(2, '0')}`,
      outputs: r.outputs.map((o) => ({ ...o, typeLabel: OUTPUT_TYPE_LABELS[o.type], overdue: o.status === 'open' && !!o.dueDate && o.dueDate < t })),
      openOutputs: r.outputs.filter((o) => o.status === 'open').length,
    };
  }

  async list(actor: OrgUser) {
    return (await this.repo.find({ where: { organizationId: actor.organizationId }, order: { meetingDate: 'DESC' } })).map((r) => this.row(r));
  }

  async get(actor: OrgUser, id: string) {
    const r = await this.repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!r) throw new NotFoundException('المراجعة غير موجودة');
    return this.row(r);
  }

  private outputs(list: ReviewDto['outputs'], old: ReviewOutput[] = []): ReviewOutput[] {
    return (list ?? []).map((o) => ({
      id: o.id && old.some((x) => x.id === o.id) ? o.id : shortId(), type: o.type, decision: o.decision, ownerName: o.ownerName, dueDate: o.dueDate ?? null, status: o.status,
    }));
  }

  async create(actor: OrgUser, dto: ReviewDto) {
    const org = actor.organizationId;
    const last = await this.repo.findOne({ where: { organizationId: org }, order: { meetingDate: 'DESC' } });
    const inputs = dto.inputs?.length ? dto.inputs : await this.reports.reviewInputs(actor, last?.meetingDate);
    const r = await this.db.transaction(async (em) => {
      const reviewNo = await this.core.nextNo(em, 'quality_management_reviews', 'review_no', org);
      return em.save(em.create(QmsReview, {
        organizationId: org, reviewNo, title: dto.title, meetingDate: dto.meetingDate, chairName: dto.chairName, attendees: dto.attendees ?? null,
        inputs, outputs: this.outputs(dto.outputs), minutes: dto.minutes ?? null,
      }));
    });
    return this.get(actor, r.id);
  }

  async update(actor: OrgUser, id: string, dto: ReviewDto) {
    const r = await this.repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!r) throw new NotFoundException('المراجعة غير موجودة');
    if (r.status === 'approved') {
      // بعد الاعتماد تُحدَّث حالة تنفيذ القرارات فقط
      const byId = new Map((dto.outputs ?? []).map((o) => [o.id, o.status]));
      r.outputs = r.outputs.map((o) => ({ ...o, status: byId.get(o.id) ?? o.status }));
    } else {
      Object.assign(r, {
        title: dto.title, meetingDate: dto.meetingDate, chairName: dto.chairName, attendees: dto.attendees ?? null, inputs: dto.inputs ?? r.inputs,
        outputs: this.outputs(dto.outputs, r.outputs), minutes: dto.minutes ?? null,
      });
    }
    await this.repo.save(r);
    return this.get(actor, r.id);
  }

  async refreshInputs(actor: OrgUser, id: string) {
    const r = await this.repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!r) throw new NotFoundException('المراجعة غير موجودة');
    if (r.status === 'approved') throw new BadRequestException('المراجعة معتمدة');
    const prev = await this.db.query(`SELECT meeting_date FROM quality_management_reviews WHERE organization_id = $1 AND meeting_date < $2 ORDER BY meeting_date DESC LIMIT 1`, [actor.organizationId, r.meetingDate]);
    r.inputs = await this.reports.reviewInputs(actor, prev[0]?.meeting_date ? String(prev[0].meeting_date).slice(0, 10) : undefined);
    await this.repo.save(r);
    return this.get(actor, r.id);
  }

  async approve(actor: OrgUser, id: string) {
    const r = await this.repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!r) throw new NotFoundException('المراجعة غير موجودة');
    if (r.status === 'approved') throw new BadRequestException('المراجعة معتمدة بالفعل');
    if (!r.outputs.length) throw new BadRequestException('سجّل قرارات المراجعة (المخرجات) قبل الاعتماد');
    Object.assign(r, { status: 'approved', approvedByName: actor.fullName, approvedAt: today() });
    await this.repo.save(r);
    return this.get(actor, r.id);
  }

  async remove(actor: OrgUser, id: string) {
    const r = await this.repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!r) throw new NotFoundException('المراجعة غير موجودة');
    if (r.status === 'approved') throw new BadRequestException('لا تُحذف مراجعة معتمدة');
    await this.repo.remove(r);
  }
}
