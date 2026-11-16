import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HR_ENTITIES } from './entities/hr.entity';
import { HrController } from './hr.controller';
import { HrCore } from './hr-core.service';
import { OrgService } from './org.service';
import { PeopleService } from './people.service';
import { PerformanceService } from './performance.service';

/**
 * الموارد البشرية: مستقلة حاليًا، تعتمد على النواة فقط. الربط مع النظام المالي (قيد الرواتب)
 * والمشاريع (تمويل الرواتب) يأتي في مراحل لاحقة عبر الخدمات المصدّرة.
 */
@Module({
  imports: [TypeOrmModule.forFeature(HR_ENTITIES)],
  controllers: [HrController],
  providers: [HrCore, OrgService, PeopleService, PerformanceService],
  exports: [HrCore, OrgService, PeopleService, PerformanceService],
})
export class HrModule {}
