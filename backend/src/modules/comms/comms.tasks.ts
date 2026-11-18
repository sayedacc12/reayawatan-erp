import { Injectable, OnModuleInit } from '@nestjs/common';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask, TasksRegistry } from '../../core/tasks/tasks.registry';
import { TasksService } from './tasks.service';
import { TransactionsService } from './transactions.service';

/** جرس المهام: المعاملات التي عندي، والقرارات والتعاميم التي لم أطلع عليها، ومهامي المفتوحة */
@Injectable()
export class CommsBell implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly txns: TransactionsService, private readonly tasks: TasksService) {}

  onModuleInit() {
    this.registry.register({ module: 'comms', name: 'الاتصالات والمهام', color: '#14b8a6', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    const [a, b] = await Promise.all([this.txns.pendingFor(u), this.tasks.pendingFor(u)]);
    return [...a, ...b];
  }
}
