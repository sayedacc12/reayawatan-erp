import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CatalogService } from './catalog.service';
import { PROCUREMENT_ENTITIES } from './entities/procurement.entity';
import { ProcurementController } from './procurement.controller';
import { ProcurementReports } from './procurement.reports';
import { ProcurementTasks } from './procurement.tasks';
import { ProcurementCore } from './procurement-core.service';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierPortalGuard } from './supplier-portal.guard';
import { SupplierPortalService } from './supplier-portal.service';
import { SuppliersService } from './suppliers.service';
import { WarehousesService } from './warehouses.service';

/**
 * المشتريات والمستودعات وبوابة الموردين (المرحلة الأولى: البيانات الأساسية).
 * يملك دليل الأصناف والمستودعات وسجل الموردين؛ ويقرأ من النظام المالي الدليل وتصنيفات الشركاء ومجموعات الأصول للاختيار،
 * وينشئ الشريك المقابل للمورد المعتمد عبر MastersService المصدّر من النظام المالي.
 */
@Module({
  imports: [TypeOrmModule.forFeature(PROCUREMENT_ENTITIES), CoreModule, AccountingModule,
    // رموز بوابة الموردين بنفس السر لكن بنوع supplier، وحارس الموظفين يرفضها
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [ProcurementController, SupplierPortalController],
  providers: [ProcurementCore, CatalogService, WarehousesService, SuppliersService, SupplierPortalService, SupplierPortalGuard, ProcurementTasks, ProcurementReports],
  exports: [ProcurementCore, CatalogService, WarehousesService, SuppliersService, SupplierPortalService],
})
export class ProcurementModule {}
