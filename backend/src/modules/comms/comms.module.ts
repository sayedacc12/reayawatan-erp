import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CommsCore } from './comms-core.service';
import { CommsController } from './comms.controller';
import { CommsReports } from './comms.reports';
import { CommsBell } from './comms.tasks';
import { COMMS_ENTITIES } from './entities/comms.entity';
import { CommsInsights } from './insights.service';
import { TasksService } from './tasks.service';
import { TransactionsService } from './transactions.service';

/**
 * الاتصالات الإدارية: المعاملات الإدارية والمالية بين الإدارات والموظفين بدرجات سرية، والقرارات والتعاميم،
 * ونظام المهام. يقرأ الهيكل التنظيمي والموظفين من الموارد البشرية، وينشئ سندات القبض والصرف عبر خدمة السندات
 * في النظام المالي. نظام الاجتماعات يحول توصياته إلى مهام عبر TasksService.
 */
@Module({
  imports: [TypeOrmModule.forFeature(COMMS_ENTITIES), CoreModule, AccountingModule],
  controllers: [CommsController],
  providers: [CommsCore, TasksService, TransactionsService, CommsInsights, CommsReports, CommsBell],
  exports: [CommsCore, TasksService, TransactionsService],
})
export class CommsModule {}
