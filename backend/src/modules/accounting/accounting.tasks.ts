import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask, TasksRegistry } from '../../core/tasks/tasks.registry';
import { ACC_PERMISSIONS as P } from './accounting.manifest';

/** مهام النظام المالي في جرس الإشعارات: السندات في مرحلة اعتماد المستخدم */
@Injectable()
export class AccountingTasks implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    this.registry.register({ module: 'accounting', name: 'النظام المالي', color: '#0ea5e9', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    if (!u.isSuperadmin && !u.permissions.includes(P.approveVouchers)) return [];
    const rows: { id: string; kind: string; serial: number; party: string; amount: string; stage: string | null; role_id: string | null; at: Date }[] = await this.db.query(
      `SELECT v.id, v.kind, v.serial, v.party_name AS party, v.amount, s.name AS stage, s.role_id, v.updated_at AS at
         FROM acc_vouchers v LEFT JOIN acc_voucher_stages s ON s.id = v.current_stage_id
        WHERE v.organization_id = $1 AND v.status = 'pending'
          AND (s.role_id IS NULL OR $2 OR s.role_id IN (SELECT role_id FROM effective_user_roles WHERE user_id = $3))
        ORDER BY v.updated_at`, [u.organizationId, u.isSuperadmin, u.id],
    );
    return rows.map((r) => ({
      id: `voucher:${r.id}`, group: r.kind === 'receipt' ? 'سندات القبض' : 'سندات الصرف', link: `/accounting/vouchers/${r.id}`, at: r.at,
      title: `${r.kind === 'receipt' ? 'سند قبض' : 'سند صرف'} رقم ${r.serial}: ${r.party}`,
      subtitle: `${Number(r.amount).toLocaleString('en-US')} ريال${r.stage ? ` · مرحلة: ${r.stage}` : ''}`,
    }));
  }
}
