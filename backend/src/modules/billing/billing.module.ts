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

/**
 * الفوترة والمبيعات (المرحلة الأولى): الإعدادات الضريبية للجمعية، وسجل العملاء والأصناف والخدمات وفئاتها الضريبية،
 * والفواتير الضريبية والمبسطة والإشعارات الدائنة والمدينة برمز QR وعداد متسلسل، وقيد كل مستند في النظام المالي (تملكه الفوترة)،
 * والتحصيل بسندات القبض (يملكها النظام المالي)، والمطابقة مع الدليل والتقارير. الربط مع منصة «فاتورة» في المرحلة الثانية.
 */
@Module({
  imports: [TypeOrmModule.forFeature(BILLING_ENTITIES), CoreModule, AccountingModule],
  controllers: [BillingController],
  providers: [BillingCore, CatalogService, DocumentsService, BillingOpsService, BillingReports],
  exports: [BillingCore, CatalogService, DocumentsService, BillingOpsService],
})
export class BillingModule {}
