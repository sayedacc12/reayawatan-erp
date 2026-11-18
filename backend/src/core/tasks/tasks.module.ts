import { Global, Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksRegistry } from './tasks.registry';

/**
 * المهام المعلقة (جرس الإشعارات). وحدة عامة: أي نظام يحقن TasksRegistry
 * ويسجل مصدر مهامه في onModuleInit.
 */
@Global()
@Module({
  controllers: [TasksController],
  providers: [TasksRegistry],
  exports: [TasksRegistry],
})
export class TasksModule {}
