import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { PLANNING_ENTITIES } from './entities/planning.entity';
import { BudgetAvailability } from './budget/budget-availability.service';
import { BudgetSources } from './budget/budget-sources.service';
import { BudgetController } from './budget/budget.controller';
import { BudgetReports } from './budget/budget.reports';
import { BudgetsService } from './budget/budgets.service';
import { FormulasService } from './budget/formulas.service';
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
  controllers: [PlanningController, BudgetController],
  providers: [PlanningCore, PlanningAnalysis, PlansService, PlanningViews, PlanningReports, BudgetSources, FormulasService, BudgetsService, BudgetAvailability, BudgetReports],
  exports: [PlanningCore, PlanningAnalysis, PlansService, PlanningViews, BudgetsService, FormulasService, BudgetAvailability],
})
export class PlanningModule {}
