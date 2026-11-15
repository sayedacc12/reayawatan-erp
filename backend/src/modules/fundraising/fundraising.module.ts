import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { DonorsService } from './donors.service';
import { FUNDRAISING_ENTITIES } from './entities';
import { DonorsController, FundraisingSettingsController, OpportunitiesController } from './fundraising.controller';
import { FundraisingService } from './fundraising.service';
import { LedgerService } from './ledger.service';
import { FundraisingReportsService } from './reports.service';
import { FundraisingSettingsService } from './settings.service';

/**
 * وحدة الموارد المالية: الداعمون، فرص التبرع ودفعاتها، مراحل الاعتماد، دفتر اليومية المبسط، والتقارير.
 * تصدّر FundraisingService (الدفعات: حجز وصرف ومناقلة) و LedgerService لنظام إدارة المشاريع.
 */
@Module({
  imports: [TypeOrmModule.forFeature(FUNDRAISING_ENTITIES), CoreModule, BeneficiariesModule],
  controllers: [FundraisingSettingsController, DonorsController, OpportunitiesController],
  providers: [FundraisingSettingsService, DonorsService, FundraisingService, LedgerService, FundraisingReportsService],
  exports: [FundraisingService, LedgerService, DonorsService, FundraisingSettingsService],
})
export class FundraisingModule {}
