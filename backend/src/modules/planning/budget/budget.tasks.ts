import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { PendingTask, TasksRegistry } from '../../../core/tasks/tasks.registry';
import { canDecide } from '../planning-calc';
import { PlanningCore } from '../planning-core.service';
import { PlanningLinks } from '../planning-links.service';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { Budget, BudgetTransfer } from './budget.entity';

/** مهام الموازنات في جرس الإشعارات: الموازنات وطلبات المناقلة في مرحلة اعتماد المستخدم */
@Injectable()
export class BudgetTasks implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly db: DataSource, private readonly core: PlanningCore, private readonly links: PlanningLinks) {}

  onModuleInit() {
    this.registry.register({ module: 'planning', name: 'التخطيط والموازنات', color: '#10b981', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    const [approvals, alerts] = await Promise.all([this.approvals(u), this.linkAlerts(u)]);
    return [...approvals, ...alerts];
  }

  /** تنبيهات الربط العاجلة لمعدّي الخطط: ارتفاع درجة خطر مرتبط، أو تأخر إجراء تصحيحي للمراجعة الداخلية */
  async linkAlerts(u: OrgUser): Promise<PendingTask[]> {
    if (!u.isSuperadmin && !u.permissions.includes(P.strategic) && !u.permissions.includes(P.operational)) return [];
    const res = await this.links.allRefs(u).catch(() => null);
    if (!res) return [];
    const { refs, live, items } = res;
    return refs.filter((r) => live.get(r.id)?.level === 'danger' && items.has(r.itemId)).map((r) => {
      const it = items.get(r.itemId)!;
      return {
        id: `plan-ref:${r.id}`, group: 'تنبيهات ربط الخطط', link: `/planning/plans/${it.planId}?tab=integrations`, at: r.createdAt,
        title: `${r.refCode ?? ''} ${r.refLabel}`.trim(), subtitle: `${live.get(r.id)!.alert} · ${it.code} ${it.title}`,
      };
    });
  }

  async approvals(u: OrgUser): Promise<PendingTask[]> {
    if (!u.isSuperadmin && !u.permissions.includes(P.budgetsApprove)) return [];
    const org = u.organizationId;
    const [budgets, transfers, d] = await Promise.all([
      this.db.getRepository(Budget).find({ where: { organizationId: org, status: 'in_review', isScenario: false } }),
      this.db.getRepository(BudgetTransfer).find({ where: { organizationId: org, status: 'in_review' } }),
      this.core.decider(u, P.budgetsApprove),
    ]);
    const stage = (r: { wfStages: { name: string }[]; stageIndex: number | null }) => (r.stageIndex !== null ? r.wfStages[r.stageIndex]?.name ?? null : null);
    return [
      ...budgets.filter((b) => canDecide(b, d)).map((b) => ({
        id: `budget:${b.id}`, group: 'اعتماد الموازنات', link: `/planning/budgets/${b.id}`, at: b.updatedAt,
        title: `${b.code} ${b.title}`, subtitle: stage(b) ? `مرحلة: ${stage(b)}` : null,
      })),
      ...transfers.filter((t) => canDecide(t, d)).map((t) => ({
        id: `budget-transfer:${t.id}`, group: 'مناقلات الموازنة', link: `/planning/budgets/${t.budgetId}?tab=execution`, at: t.updatedAt,
        title: `${t.code}: ${t.kind === 'transfer' ? `مناقلة من ${t.fromName} إلى ${t.toName}` : t.kind === 'increase' ? `زيادة ${t.toName}` : `تخفيض ${t.fromName}`}`,
        subtitle: `${t.amount.toLocaleString('en-US')} ريال${stage(t) ? ` · مرحلة: ${stage(t)}` : ''}`,
      })),
    ];
  }
}
