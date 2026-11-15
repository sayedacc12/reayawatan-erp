import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { BeneficiaryRequest, Ticket, TicketType } from './entities';

export interface NewTicket {
  type: TicketType;
  subject: string;
  message: string;
  requestId?: string | null;
}

/** الشكاوى والمقترحات والاستفسارات: المستفيد يرسل من البوابة والموظف يرد */
@Injectable()
export class TicketsService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
  ) {}

  async list(actor: OrgUser, q: { type?: string; status?: string }) {
    const qb = this.tickets.createQueryBuilder('t')
      .innerJoin('t.beneficiary', 'b')
      .addSelect(['b.id', 'b.fullName', 'b.fileNo', 'b.phone'])
      .where('t.organization_id = :org', { org: actor.organizationId });
    if (q.type) qb.andWhere('t.type = :type', { type: q.type });
    if (q.status) qb.andWhere('t.status = :status', { status: q.status });
    const rows = await qb.orderBy("CASE WHEN t.status = 'open' THEN 0 ELSE 1 END").addOrderBy('t.created_at', 'DESC').limit(200).getMany();
    const counts: { status: string; count: number }[] = await this.db.query(
      'SELECT status, COUNT(*)::int AS count FROM beneficiary_tickets WHERE organization_id = $1 GROUP BY status', [actor.organizationId],
    );
    return { items: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.count])) };
  }

  async reply(actor: OrgUser, id: string, reply: string, close: boolean) {
    const t = await this.tickets.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!t) throw new NotFoundException('الرسالة غير موجودة');
    Object.assign(t, { reply, repliedByName: actor.fullName, repliedAt: new Date(), status: close ? 'closed' : 'answered' });
    return this.tickets.save(t);
  }

  // ---- من البوابة ----

  listForBeneficiary(organizationId: string, beneficiaryId: string) {
    return this.tickets.find({ where: { organizationId, beneficiaryId }, order: { createdAt: 'DESC' } });
  }

  async create(organizationId: string, beneficiaryId: string, input: NewTicket) {
    if (input.requestId) {
      const ok = await this.db.getRepository(BeneficiaryRequest).exists({
        where: { id: input.requestId, organizationId, beneficiaryId },
      });
      if (!ok) throw new BadRequestException('الطلب المرتبط غير موجود');
    }
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tickets:${organizationId}`]);
      const [{ next }] = await em.query(
        'SELECT COALESCE(MAX(ticket_no), 0) + 1 AS next FROM beneficiary_tickets WHERE organization_id = $1', [organizationId],
      );
      return em.save(em.create(Ticket, {
        organizationId, beneficiaryId, ticketNo: Number(next), type: input.type, subject: input.subject,
        message: input.message, requestId: input.requestId ?? null, status: 'open',
      }));
    });
  }
}
