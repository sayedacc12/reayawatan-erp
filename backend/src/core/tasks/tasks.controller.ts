import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { TasksRegistry } from './tasks.registry';

/** جرس الإشعارات: المهام المعلقة عند المستخدم في كل الأنظمة */
@Controller('tasks')
export class TasksController {
  constructor(private readonly registry: TasksRegistry) {}

  @Get()
  async mine(@CurrentUser() user: AuthUser) {
    if (!user.organizationId) return { total: 0, groups: [] };
    return this.registry.collect(user as AuthUser & { organizationId: string });
  }
}
