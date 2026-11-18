import { HrReports } from './hr.reports';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { HrTasks } from './hr.tasks';
import { RequestsService } from './requests.service';
import { SelfServiceController } from './self-service.controller';
import { SeparationController } from './separation.controller';
import { SeparationService } from './separation.service';
import { SelfServiceService } from './self-service.service';
import { AttendanceService } from './attendance.service';
import { DevelopmentController } from './development.controller';
import { DevelopmentService } from './development.service';
import { HR_ENTITIES } from './entities/hr.entity';
import { HrController } from './hr.controller';
import { HrCore } from './hr-core.service';
import { OrgService } from './org.service';
import { IclockController, PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PeopleService } from './people.service';
import { PerformanceService } from './performance.service';

/**
 * الموارد البشرية. ترتبط بالنظام المالي في مسير الرواتب: قيد استحقاق الرواتب عند الاعتماد النهائي،
 * وسندات صرف مسودة تمر بمراحل اعتماد سندات الصرف. الربط مع المشاريع (تمويل الرواتب) في مرحلة لاحقة.
 */
@Module({
  imports: [TypeOrmModule.forFeature(HR_ENTITIES), AccountingModule, CoreModule],
  controllers: [HrController, PayrollController, IclockController, DevelopmentController, SelfServiceController, SeparationController],
  providers: [HrCore, OrgService, PeopleService, PerformanceService, AttendanceService, PayrollService, DevelopmentService, HrReports, RequestsService, SelfServiceService, HrTasks, SeparationService],
  exports: [HrCore, OrgService, PeopleService, PerformanceService, AttendanceService, PayrollService, DevelopmentService, RequestsService, SelfServiceService, SeparationService],
})
export class HrModule {}
