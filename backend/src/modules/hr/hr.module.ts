import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingModule } from '../accounting/accounting.module';
import { AttendanceService } from './attendance.service';
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
  imports: [TypeOrmModule.forFeature(HR_ENTITIES), AccountingModule],
  controllers: [HrController, PayrollController, IclockController],
  providers: [HrCore, OrgService, PeopleService, PerformanceService, AttendanceService, PayrollService],
  exports: [HrCore, OrgService, PeopleService, PerformanceService, AttendanceService, PayrollService],
})
export class HrModule {}
