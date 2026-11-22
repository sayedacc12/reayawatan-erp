import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { BillingController } from './billing.controller';
import { BillingCore } from './billing-core.service';
import { BillingOpsService } from './billing-ops.service';
import { BillingReports } from './billing.reports';
import { CatalogService } from './catalog.service';
import { DocumentsService } from './documents.service';
import { BILLING_ENTITIES } from './entities/billing.entity';
import { ZatcaApi } from './einvoice/zatca-api';
import { ZatcaController } from './zatca.controller';
import { ZatcaService } from './zatca.service';

/**
 * الفوترة والمبيعات (المرحلة الأولى): الإعدادات الضريبية للشركة، وسجل العملاء والأصناف والخدمات وفئاتها الضريبية،
 * والفواتير الضريبية والمبسطة والإشعارات الدائنة والمدينة برمز QR وعداد متسلسل، وقيد كل مستند في النظام المالي (تملكه الفوترة)،
 * والتحصيل بسندات القبض (يملكها النظام المالي)، والمطابقة مع الدليل والتقارير.
 * المرحلة الثانية: الربط مع منصة «فاتورة» (شهادة لكل جمعية) والملف الإلكتروني الموقّع لكل مستند ضريبي وسلسلة بصماته.
 */
@Module({
  imports: [TypeOrmModule.forFeature(BILLING_ENTITIES), CoreModule, AccountingModule],
  controllers: [BillingController, ZatcaController],
  providers: [BillingCore, CatalogService, DocumentsService, BillingOpsService, BillingReports, ZatcaApi, ZatcaService],
  exports: [BillingCore, CatalogService, DocumentsService, BillingOpsService, ZatcaService],
})
export class BillingModule {}
