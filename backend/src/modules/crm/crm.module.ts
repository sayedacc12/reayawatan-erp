import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { ActivitiesService } from './activities.service';
import { CrmCore } from './crm-core.service';
import { CrmController } from './crm.controller';
import { CrmReports } from './crm.reports';
import { CrmTasks } from './crm.tasks';
import { CRM_ENTITIES } from './entities/crm.entity';
import { LeadsService } from './leads.service';
import { PartiesService } from './parties.service';

/** توكن استقبال طلبات نماذج الموقع: يستخدمه الموقع الإلكتروني دون أن يعتمد على هذه الوحدة مباشرة */
export const CRM_LEAD_INTAKE = 'CRM_LEAD_INTAKE';

/**
 * علاقات العملاء والتسويق (المرحلة 1): سجل الجهات الموحد وربطه بسجلات العملاء والأعضاء والمتطوعين والشركاء
 * (قراءة فقط من أنظمتها)، ومنع التكرار والدمج، والعملاء المحتملون وتوزيعهم ومهلة التواصل الأول وتأهيلهم، والأنشطة والتقويم.
 * لا ينشئ قيودًا محاسبية، ولا يكتب في جداول الأنظمة الأخرى.
 */
@Module({
  imports: [TypeOrmModule.forFeature(CRM_ENTITIES), CoreModule],
  controllers: [CrmController],
  providers: [CrmCore, PartiesService, LeadsService, ActivitiesService, CrmReports, CrmTasks, { provide: CRM_LEAD_INTAKE, useExisting: LeadsService }],
  exports: [CrmCore, PartiesService, LeadsService, ActivitiesService, CRM_LEAD_INTAKE],
})
export class CrmModule {}
