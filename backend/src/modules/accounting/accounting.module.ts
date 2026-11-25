import { AccountingTasks } from './accounting.tasks';
import { AccountingReports } from './accounting.reports';
import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AssetBudgetService } from './asset-budget.service';
import { AssetImportService } from './asset-import.service';
import { ChartImportService } from './chart-import.service';
import { AssetMaintenanceService } from './asset-maintenance.service';
import { AssetOpsService } from './asset-ops.service';
import { AssetsController } from './assets.controller';
import { AssetsReports } from './assets.reports';
import { AssetsService } from './assets.service';
import { ASSET_ENTITIES } from './entities/assets.entity';
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
import { StatementsController } from './statements/statements.controller';
import { FS_ENTITIES } from './statements/statements.entity';
import { StatementsService } from './statements/statements.service';

/**
 * النظام المالي (المحاسبي): مستقل حاليًا، يعتمد على النواة فقط (الدخول والصلاحيات وبيانات الشركة).
 * الربط مع المستفيدين والموارد المالية والمشاريع يأتي لاحقًا عبر createSystemEntry وحقول مصدر السند.
 */
@Module({
  imports: [TypeOrmModule.forFeature([...ACCOUNTING_ENTITIES, ...ASSET_ENTITIES, ...FS_ENTITIES]), CoreModule],
  controllers: [AccountingController, AssetsController, StatementsController],
  providers: [AccCore, AccountsService, MastersService, EntriesService, SetupService, InventoryService, VouchersService, ReportsService, AccountingReports, AccountingTasks, AssetsService, AssetOpsService, AssetsReports, AssetMaintenanceService, AssetBudgetService, AssetImportService, ChartImportService, StatementsService],
  exports: [AccCore, AccountsService, MastersService, EntriesService, SetupService, VouchersService, AssetsService, AssetOpsService, AssetMaintenanceService, AssetBudgetService, StatementsService],
})
export class AccountingModule {}
