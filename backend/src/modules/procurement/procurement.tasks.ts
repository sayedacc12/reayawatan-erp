import { Injectable, OnModuleInit } from '@nestjs/common';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask, TasksRegistry } from '../../core/tasks/tasks.registry';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { SuppliersService } from './suppliers.service';

/** مهام المشتريات في جرس الإشعارات: طلبات تسجيل الموردين، ومستنداتهم، وحساباتهم البنكية بانتظار الاعتماد */
@Injectable()
export class ProcurementTasks implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly suppliers: SuppliersService) {}

  onModuleInit() {
    this.registry.register({ module: 'procurement', name: 'المشتريات والمستودعات', color: '#b45309', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    const can = (p: string) => u.isSuperadmin || u.permissions.includes(p);
    if (!can(P.approveSuppliers) && !can(P.approveBanks)) return [];
    const a = await this.suppliers.approvals(u);
    const out: PendingTask[] = [];
    if (can(P.approveSuppliers)) {
      for (const s of a.suppliers) {
        out.push({ id: `pr-sup:${s.id}`, group: 'تسجيل الموردين', link: `/procurement/suppliers/${s.id}`, at: s.submittedAt, title: `طلب تسجيل مورد: ${s.name}`, subtitle: s.code });
      }
      for (const d of a.docs) {
        out.push({ id: `pr-doc:${d.id}`, group: 'مستندات الموردين', link: `/procurement/suppliers/${d.supplierId}`, at: d.createdAt, title: `مراجعة مستند «${d.title}»`, subtitle: d.supplier });
      }
    }
    if (can(P.approveBanks)) {
      for (const b of a.banks.filter((x: { mine: boolean }) => !x.mine)) {
        out.push({
          id: `pr-bank:${b.id}`, group: 'الحسابات البنكية للموردين', link: `/procurement/suppliers/${b.supplierId}`, at: b.createdAt, urgent: b.isChange,
          title: `${b.isChange ? 'تغيير' : 'اعتماد'} حساب بنكي: ${b.supplier}`, subtitle: `${b.bankName} · ${b.iban.slice(0, 4)}…${b.iban.slice(-4)}`,
        });
      }
    }
    return out;
  }
}
