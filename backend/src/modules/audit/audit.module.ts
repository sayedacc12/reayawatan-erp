import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { ActionsService } from './actions.service';
import { AuditController } from './audit.controller';
import { AuditCore } from './audit-core.service';
import { EngagementService } from './engagement.service';
import { AUDIT_ENTITIES } from './entities/audit.entity';
import { InsightsService } from './insights.service';
import { PlanningService } from './planning.service';

/**
 * المراجعة الداخلية المبنية على المخاطر. تقرأ الهيكل التنظيمي من الموارد البشرية (الجهات المسؤولة)،
 * وتقرأ سجل المخاطر وضوابطه من وحدة المخاطر عبر 'RISK_REGISTER_LOOKUP' إن كانت مثبتة، دون الكتابة في جداولها.
 * مراجعة الجودة الداخلية (ISO 9001) في نظام الجودة وليست هنا.
 */
@Module({
  imports: [TypeOrmModule.forFeature(AUDIT_ENTITIES), CoreModule],
  controllers: [AuditController],
  providers: [AuditCore, PlanningService, EngagementService, ActionsService, InsightsService],
  exports: [AuditCore, PlanningService, EngagementService, ActionsService, InsightsService],
})
export class AuditModule {}
