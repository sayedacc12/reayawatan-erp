import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CORE_PERMISSIONS } from '../core.manifest';
import { OrgUser } from './decorators';
import { PendingTask, TasksRegistry } from '../tasks/tasks.registry';

/** جرس المهام: طلبات «نسيت كلمة المرور» من موظفي الجمعية تصل لمن يدير المستخدمين */
@Injectable()
export class CoreTasks implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    this.registry.register({ module: 'core', name: 'الإعدادات', color: '#64748b', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    if (!u.permissions.includes(CORE_PERMISSIONS.usersManage)) return [];
    const rows: { id: string; name: string; at: Date; admin: boolean }[] = await this.db.query(
      `SELECT r.id, r.subject_name AS name, r.created_at AS at, u.is_superadmin AS admin
         FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.organization_id = $1 AND r.audience = 'staff' AND r.status = 'pending'
          AND r.created_at > now() - interval '7 days' AND r.user_id <> $2
        ORDER BY r.created_at LIMIT 50`, [u.organizationId, u.id],
    );
    // طلب مدير النظام يراه مدير نظام آخر فقط (ومالك المنصة)
    return rows.filter((r) => !r.admin || u.isSuperadmin).map((r) => ({
      id: `pwd:${r.id}`, group: 'استعادة كلمة المرور', link: '/settings/users', at: r.at, urgent: true,
      title: `${r.name} نسي كلمة المرور`, subtitle: 'أصدر له كلمة مرور مؤقتة',
    }));
  }
}
