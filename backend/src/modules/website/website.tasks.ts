import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask, TasksRegistry } from '../../core/tasks/tasks.registry';
import { WEBSITE_PERMISSIONS as P } from './website.manifest';
import { SOURCE_LABEL } from './leads.service';
import { LeadSource } from './entities/website.entity';

/** جرس المهام: طلبات الموقع الجديدة، ومواعيد المتابعة المستحقة، وجلسات التشخيص خلال 24 ساعة */
@Injectable()
export class WebsiteTasks implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    this.registry.register({ module: 'website', name: 'الموقع', color: '#164e38', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    if (!u.permissions.includes(P.leadsManage)) return [];
    const org = u.organizationId;
    const [fresh, due, soon] = await Promise.all([
      this.db.query(`SELECT id, lead_no AS no, source, name, org_name AS org, created_at AS at FROM rw_leads
                      WHERE organization_id = $1 AND status = 'new' AND (assigned_to IS NULL OR assigned_to = $2) ORDER BY created_at LIMIT 30`, [org, u.id]),
      this.db.query(`SELECT id, lead_no AS no, name, next_action_on AS at FROM rw_leads
                      WHERE organization_id = $1 AND assigned_to = $2 AND status IN ('contacted','qualified','proposal')
                        AND next_action_on <= (now() AT TIME ZONE 'Asia/Riyadh')::date ORDER BY next_action_on LIMIT 30`, [org, u.id]),
      this.db.query(`SELECT b.id, b.starts_at AS at, l.id AS lead, l.name FROM rw_bookings b JOIN rw_leads l ON l.id = b.lead_id AND l.organization_id = b.organization_id
                      WHERE b.organization_id = $1 AND b.status IN ('booked','confirmed') AND b.starts_at BETWEEN now() AND now() + interval '24 hours'
                        AND (b.consultant_id IS NULL OR b.consultant_id = $2) ORDER BY b.starts_at LIMIT 20`, [org, u.id]),
    ]);
    return [
      ...fresh.map((r: { id: string; no: number; source: LeadSource; name: string; org: string | null; at: Date }) => ({
        id: `lead:${r.id}`, group: 'طلبات جديدة', link: `/website/leads/${r.id}`, at: r.at, urgent: Date.now() - new Date(r.at).getTime() > 2 * 86400000,
        title: `${SOURCE_LABEL[r.source]}: ${r.name}${r.org ? ` (${r.org})` : ''}`, subtitle: `طلب رقم ${r.no}، تواصلوا معه خلال يومي عمل`,
      })),
      ...due.map((r: { id: string; no: number; name: string; at: string }) => ({
        id: `due:${r.id}`, group: 'متابعات مستحقة', link: `/website/leads/${r.id}`, at: r.at, title: `متابعة ${r.name}`, subtitle: `طلب رقم ${r.no}`,
      })),
      ...soon.map((r: { id: string; at: Date; lead: string; name: string }) => ({
        id: `bk:${r.id}`, group: 'جلسات التشخيص القادمة', link: `/website/leads/${r.lead}`, at: r.at, urgent: true, title: `جلسة تشخيص مع ${r.name}`, subtitle: 'خلال 24 ساعة',
      })),
    ];
  }
}
