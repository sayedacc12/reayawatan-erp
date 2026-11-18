import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask, TasksRegistry } from '../../core/tasks/tasks.registry';

/** مهام المساعدات الاجتماعية في جرس الإشعارات: طلبات المستفيدين في مرحلة يملك المستخدم قرارها */
@Injectable()
export class BeneficiariesTasks implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    this.registry.register({ module: 'beneficiaries', name: 'المساعدات الاجتماعية', color: '#14b8a6', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    if (!u.isSuperadmin && !u.permissions.includes('beneficiaries.requests.process')) return [];
    const rows: { id: string; no: number; name: string; stage: string; at: Date }[] = await this.db.query(
      `SELECT r.id, r.request_no AS no, b.full_name AS name, s.name AS stage, r.updated_at AS at
         FROM beneficiary_requests r JOIN workflow_stages s ON s.id = r.current_stage_id JOIN beneficiaries b ON b.id = r.beneficiary_id
        WHERE r.organization_id = $1 AND r.status = 'in_progress'
          AND (s.role_id IS NULL OR $2 OR s.role_id IN (SELECT role_id FROM user_roles WHERE user_id = $3))
        ORDER BY r.updated_at LIMIT 100`, [u.organizationId, u.isSuperadmin, u.id],
    );
    return rows.map((r) => ({
      id: `ben:${r.id}`, group: 'طلبات المستفيدين', link: `/beneficiaries/requests/${r.id}`, at: r.at, urgent: Date.now() - new Date(r.at).getTime() > 5 * 86400000,
      title: `طلب رقم ${r.no}: ${r.name}`, subtitle: `مرحلة: ${r.stage}`,
    }));
  }
}
