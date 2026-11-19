import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { PLANNING_ENTITIES } from './entities/planning.entity';
import { PlanningAnalysis } from './planning-analysis.service';
import { PlanningCore } from './planning-core.service';
import { PlanningViews } from './planning-views.service';
import { PlanningController } from './planning.controller';
import { PlanningReports } from './planning.reports';
import { PlansService } from './plans.service';

/**
 * التخطيط الاستراتيجي والتشغيلي (المرحلة الأولى من نظام التخطيط والموازنات).
 * يقرأ من الأنظمة الأخرى للاختيار والربط فقط (الهيكل التنظيمي، المستخدمون، المشاريع، مراكز التكلفة، الموازنة الرأسمالية)
 * ولا يكتب في جداولها؛ والمراجع تُحفظ برمزها وعنوانها في plan_refs.
 */
@Module({
  imports: [TypeOrmModule.forFeature(PLANNING_ENTITIES), CoreModule],
  controllers: [PlanningController],
  providers: [PlanningCore, PlanningAnalysis, PlansService, PlanningViews, PlanningReports],
  exports: [PlanningCore, PlanningAnalysis, PlansService, PlanningViews],
})
export class PlanningModule {}
