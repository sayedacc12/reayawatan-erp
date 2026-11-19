import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { FundraisingModule } from '../fundraising/fundraising.module';
import { PlanningModule } from '../planning/planning.module';
import { CatalogService } from './catalog.service';
import { PROCUREMENT_ENTITIES } from './entities/procurement.entity';
import { SOURCING_ENTITIES } from './entities/sourcing.entity';
import { ProcurementController } from './procurement.controller';
import { ProcurementReports } from './procurement.reports';
import { ProcurementTasks } from './procurement.tasks';
import { ProcurementCore } from './procurement-core.service';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierPortalGuard } from './supplier-portal.guard';
import { SupplierPortalService } from './supplier-portal.service';
import { SuppliersService } from './suppliers.service';
import { WarehousesService } from './warehouses.service';
import { OrdersService } from './orders.service';
import { RequestsService } from './requests.service';
import { RfqsService } from './rfqs.service';
import { SourcingCore } from './sourcing-core.service';
import { SourcingController } from './sourcing.controller';
import { SourcingPortalService } from './sourcing-portal.service';

/**
 * المشتريات والمستودعات وبوابة الموردين (المرحلة الأولى: البيانات الأساسية، والثانية: طلبات الشراء والمنافسات والتعميدات).
 * يملك دليل الأصناف والمستودعات وسجل الموردين؛ ويقرأ من النظام المالي الدليل وتصنيفات الشركاء ومجموعات الأصول للاختيار،
 * وينشئ الشريك المقابل للمورد المعتمد عبر MastersService المصدّر من النظام المالي.
 */
@Module({
  imports: [TypeOrmModule.forFeature([...PROCUREMENT_ENTITIES, ...SOURCING_ENTITIES]), CoreModule, AccountingModule, PlanningModule, FundraisingModule,
    // رموز بوابة الموردين بنفس السر لكن بنوع supplier، وحارس الموظفين يرفضها
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [ProcurementController, SourcingController, SupplierPortalController],
  providers: [ProcurementCore, CatalogService, WarehousesService, SuppliersService, SupplierPortalService, SupplierPortalGuard, ProcurementTasks, ProcurementReports,
    SourcingCore, RequestsService, RfqsService, OrdersService, SourcingPortalService],
  exports: [ProcurementCore, CatalogService, WarehousesService, SuppliersService, SupplierPortalService, SourcingCore, RequestsService, RfqsService, OrdersService, SourcingPortalService],
})
export class ProcurementModule {}
