import { Injectable, OnModuleInit } from '@nestjs/common';
import { TasksRegistry } from '../../core/tasks/tasks.registry';
import { MeetingsService } from './meetings.service';

/** جرس المهام: خطط الاجتماعات بانتظار اعتمادي، والدعوات التي لم أرد عليها، والمحاضر بانتظار توقيعي */
@Injectable()
export class MeetingsBell implements OnModuleInit {
  constructor(private readonly registry: TasksRegistry, private readonly meetings: MeetingsService) {}

  onModuleInit() {
    this.registry.register({ module: 'meetings', name: 'الاجتماعات', color: '#8b5cf6', collect: (u) => this.meetings.pendingFor(u) });
  }
}
