import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask, TasksRegistry } from '../../core/tasks/tasks.registry';
import { CRM_PERMISSIONS as P } from './crm.manifest';
import { leadCode } from './crm-core.service';

/** مهام علاقات العملاء في جرس الإشعارات: عملاء محتملون بلا مسؤول، وتجاوز مهلة التواصل الأول، والأنشطة المستحقة والمتأخرة */
@Injectable()
export class CrmTasks implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    this.registry.register({ module: 'crm', name: 'علاقات العملاء', color: '#0e7490', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    const has = (p: string) => u.isSuperadmin || u.permissions.includes(p);
    if (!has(P.read)) return [];
    const org = u.organizationId;
    const out: PendingTask[] = [];
    if (has(P.assign) || has(P.all)) {
      const unassigned: { id: string; lead_no: number; name: string; created_at: Date }[] = await this.db.query(
        `SELECT id, lead_no, name, created_at FROM crm_leads WHERE organization_id = $1 AND owner_id IS NULL AND status IN ('new', 'contacted', 'qualified') ORDER BY created_at LIMIT 30`, [org]);
      out.push(...unassigned.map((l) => ({ id: `crm-un:${l.id}`, group: 'عملاء محتملون بانتظار التوزيع', link: `/crm/leads/${l.id}`, at: l.created_at, title: `${l.name} (${leadCode(l.lead_no)})`, subtitle: 'أسنده لأحد أعضاء الفريق' })));
    }
    const late: { id: string; lead_no: number; name: string; due_at: Date }[] = await this.db.query(
      `SELECT id, lead_no, name, due_at FROM crm_leads WHERE organization_id = $1 AND owner_id = $2 AND status IN ('new', 'contacted', 'qualified')
          AND first_contact_at IS NULL AND due_at < now() + interval '2 hours' ORDER BY due_at LIMIT 30`, [org, u.id]);
    out.push(...late.map((l) => ({
      id: `crm-sla:${l.id}`, group: 'التواصل الأول', link: `/crm/leads/${l.id}`, at: l.due_at, title: `تواصل مع ${l.name} (${leadCode(l.lead_no)})`,
      subtitle: l.due_at < new Date() ? 'تجاوز مهلة التواصل الأول' : 'تنتهي مهلة التواصل الأول قريبًا', urgent: l.due_at < new Date(),
    })));
    const acts: { id: string; subject: string; due_at: Date; party_id: string | null; lead_id: string | null; related: string | null }[] = await this.db.query(
      `SELECT a.id, a.subject, a.due_at, a.party_id, a.lead_id, COALESCE(p.name, l.name) AS related FROM crm_activities a
         LEFT JOIN crm_parties p ON p.id = a.party_id AND p.organization_id = $1 LEFT JOIN crm_leads l ON l.id = a.lead_id AND l.organization_id = $1
        WHERE a.organization_id = $1 AND a.owner_id = $2 AND a.done_at IS NULL
          AND (a.due_at AT TIME ZONE 'Asia/Riyadh')::date <= (now() AT TIME ZONE 'Asia/Riyadh')::date ORDER BY a.due_at LIMIT 40`, [org, u.id]);
    out.push(...acts.map((a) => ({
      id: `crm-act:${a.id}`, group: 'متابعات اليوم والمتأخرة', link: a.party_id ? `/crm/parties/${a.party_id}` : a.lead_id ? `/crm/leads/${a.lead_id}` : '/crm/activities',
      at: a.due_at, title: a.subject, subtitle: a.related, urgent: a.due_at < new Date(),
    })));
    return out;
  }
}
