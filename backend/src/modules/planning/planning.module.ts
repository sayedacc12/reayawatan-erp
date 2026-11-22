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
import { ScenariosService } from './budget/scenarios.service';
import { BudgetExecution } from './budget/budget-execution.service';
import { BudgetTasks } from './budget/budget.tasks';
import { PlanningAnalysis } from './planning-analysis.service';
import { PlanningCore } from './planning-core.service';
import { PlanningViews } from './planning-views.service';
import { PlanningController } from './planning.controller';
import { PlanningReports } from './planning.reports';
import { PlanningLinks } from './planning-links.service';
import { PlansService } from './plans.service';

/**
 * التخطيط الاستراتيجي والتشغيلي (المرحلة الأولى من نظام التخطيط والموازنات).
 * يقرأ من الأنظمة الأخرى للاختيار والربط فقط (الهيكل التنظيمي، المستخدمون، المشاريع، مراكز التكلفة، الموازنة الرأسمالية)
 * ولا يكتب في جداولها؛ والمراجع تُحفظ برمزها وعنوانها في plan_refs.
 */
import { PlanImportService } from './plan-import.service';
import { BudgetImportService } from './budget/budget-import.service';
import { BoardReportsController } from './board/board-reports.controller';
import { BoardReportsService } from './board/board-reports.service';

@Module({
  imports: [TypeOrmModule.forFeature(PLANNING_ENTITIES), CoreModule],
  controllers: [PlanningController, BudgetController, BoardReportsController],
  providers: [PlanningCore, PlanningAnalysis, PlanningLinks, PlansService, PlanImportService, BudgetImportService, PlanningViews, PlanningReports, BudgetSources, FormulasService, BudgetsService, BudgetAvailability, ScenariosService, BudgetExecution, BudgetReports, BudgetTasks, BoardReportsService],
  exports: [PlanningCore, PlanningAnalysis, PlanningLinks, PlansService, PlanImportService, BudgetImportService, PlanningViews, BudgetsService, FormulasService, BudgetAvailability, ScenariosService, BudgetExecution],
})
export class PlanningModule {}
