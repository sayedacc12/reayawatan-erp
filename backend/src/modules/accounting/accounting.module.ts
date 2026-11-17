import { AccountingReports } from './accounting.reports';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccCore } from './acc-core.service';
import { AccountingController } from './accounting.controller';
import { AccountsService } from './accounts.service';
import { ACCOUNTING_ENTITIES } from './entities/accounting.entity';
import { EntriesService } from './entries.service';
import { InventoryService } from './inventory.service';
import { MastersService } from './masters.service';
import { ReportsService } from './reports.service';
import { SetupService } from './setup.service';
import { VouchersService } from './vouchers.service';

/**
 * النظام المالي (المحاسبي): مستقل حاليًا، يعتمد على النواة فقط (الدخول والصلاحيات وبيانات الجمعية).
 * الربط مع المستفيدين والموارد المالية والمشاريع يأتي لاحقًا عبر createSystemEntry وحقول مصدر السند.
 */
@Module({
  imports: [TypeOrmModule.forFeature(ACCOUNTING_ENTITIES)],
  controllers: [AccountingController],
  providers: [AccCore, AccountsService, MastersService, EntriesService, SetupService, InventoryService, VouchersService, ReportsService, AccountingReports],
  exports: [AccCore, AccountsService, MastersService, EntriesService, SetupService, VouchersService],
})
export class AccountingModule {}
