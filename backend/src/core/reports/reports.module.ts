import { Global, Module } from '@nestjs/common';
import { ReportPdfService } from './report-pdf.service';
import { ReportsController } from './reports.controller';
import { ReportsRegistry } from './reports.registry';

/**
 * بنية التقارير المشتركة. وحدة عامة (Global): أي نظام يحقن ReportsRegistry
 * ويسجل تقاريره دون استيراد هذه الوحدة. انظر README.md في نفس المجلد.
 */
@Global()
@Module({
  controllers: [ReportsController],
  providers: [ReportsRegistry, ReportPdfService],
  exports: [ReportsRegistry, ReportPdfService],
})
export class ReportsModule {}
