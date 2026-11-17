import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { ApplicationsService } from './applications.service';
import { BillingService } from './billing.service';
import { MEMBERS_ENTITIES } from './entities/members.entity';
import { MembersController, PublicMembersController } from './members.controller';
import { MembersService } from './members.service';
import { MemCore } from './mem-core.service';
import { MemReportsService } from './reports.service';
import { MembersReports } from './members.reports';

/**
 * عضوية الجمعية العمومية: طلبات العضوية من الموقع أو داخليًا ومراحل اعتمادها، سجل الأعضاء وهوياتهم،
 * أنواع العضوية واشتراكاتها، المطالبات والدفع الإلكتروني، التجديد والتنبيهات، وحق التصويت.
 * ترتبط بالنظام المالي بسند قبض لكل تحصيل يمر بمراحل اعتماد سندات القبض.
 */
@Module({
  imports: [TypeOrmModule.forFeature(MEMBERS_ENTITIES), CoreModule, AccountingModule],
  controllers: [MembersController, PublicMembersController],
  providers: [MembersReports, MemCore, MembersService, BillingService, ApplicationsService, MemReportsService],
  exports: [MemCore, MembersService, BillingService, ApplicationsService, MemReportsService],
})
export class MembersModule {}
