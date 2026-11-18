import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask, TasksRegistry } from '../../core/tasks/tasks.registry';
import { PARTNERSHIP_PERMISSIONS as P } from './partnerships.manifest';
import { ptToday } from './partnerships.service';

/** مهام الشراكات في جرس الإشعارات: الاعتمادات، وطلبات تعديل الشركاء، والالتزامات المتأخرة، والعقود القريبة من الانتهاء */
@Injectable()
export class PartnershipsTasks implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    this.registry.register({ module: 'partnerships', name: 'الشراكات', color: '#b45309', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    const has = (p: string) => u.isSuperadmin || u.permissions.includes(p);
    const org = u.organizationId;
    const t = ptToday();
    const out: PendingTask[] = [];
    if (has(P.approve)) {
      const evals: { id: string; partner_id: string; name: string; total: string; at: Date }[] = await this.db.query(
        `SELECT e.id, e.partner_id, p.name, e.total, e.submitted_at AS at FROM pt_evaluations e JOIN pt_partners p ON p.id = e.partner_id
          WHERE e.organization_id = $1 AND e.status = 'submitted' ORDER BY e.submitted_at`, [org]);
      out.push(...evals.map((e) => ({ id: `pt-eval:${e.id}`, group: 'اعتماد الشركاء', link: '/partnerships/approvals', at: e.at, title: `تقييم الشريك: ${e.name}`, subtitle: `الدرجة ${Number(e.total)} من 100` })));
      const contracts: { id: string; number: string; title: string; at: Date }[] = await this.db.query(
        `SELECT id, number, title, updated_at AS at FROM pt_contracts WHERE organization_id = $1 AND status = 'review' ORDER BY updated_at`, [org]);
      out.push(...contracts.map((c) => ({ id: `pt-contract:${c.id}`, group: 'اعتماد العقود', link: `/partnerships/contracts/${c.id}`, at: c.at, title: `عقد ${c.number} بانتظار الاعتماد`, subtitle: c.title })));
    }
    if (has(P.contracts)) {
      const changes: { id: string; number: string; name: string; at: Date }[] = await this.db.query(
        `SELECT c.id, c.number, p.name, c.updated_at AS at FROM pt_contracts c JOIN pt_partners p ON p.id = c.partner_id
          WHERE c.organization_id = $1 AND c.status = 'changes_requested'`, [org]);
      out.push(...changes.map((c) => ({ id: `pt-changes:${c.id}`, group: 'طلبات تعديل الشركاء', link: `/partnerships/contracts/${c.id}`, at: c.at, title: `طلب ${c.name} تعديل العقد ${c.number}`, urgent: true })));
      const late: { id: string; contract_id: string; title: string; due_date: string; number: string }[] = await this.db.query(
        `SELECT f.id, f.contract_id, f.title, f.due_date::text, c.number FROM pt_followups f JOIN pt_contracts c ON c.id = f.contract_id
          WHERE f.organization_id = $1 AND f.done_at IS NULL AND f.due_date < $2 ORDER BY f.due_date LIMIT 30`, [org, t]);
      out.push(...late.map((f) => ({ id: `pt-fu:${f.id}`, group: 'التزامات متأخرة', link: `/partnerships/contracts/${f.contract_id}`, at: f.due_date, title: f.title, subtitle: `العقد ${f.number} · استحق ${f.due_date}`, urgent: true })));
      const ending: { id: string; number: string; name: string; ends_on: string }[] = await this.db.query(
        `SELECT c.id, c.number, p.name, c.ends_on::text FROM pt_contracts c JOIN pt_partners p ON p.id = c.partner_id
          WHERE c.organization_id = $1 AND c.status = 'signed' AND c.ends_on BETWEEN $2::date AND $2::date + 30
            AND NOT EXISTS (SELECT 1 FROM pt_contracts r WHERE r.renewal_of = c.id AND r.status <> 'cancelled')`, [org, t]);
      out.push(...ending.map((c) => ({ id: `pt-end:${c.id}`, group: 'عقود تنتهي قريبًا', link: `/partnerships/contracts/${c.id}`, at: c.ends_on, title: `ينتهي عقد ${c.name} (${c.number})`, subtitle: `في ${c.ends_on}، جدّده أو أغلقه` })));
    }
    return out;
  }
}
