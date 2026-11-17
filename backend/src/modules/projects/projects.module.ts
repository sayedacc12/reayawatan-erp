import { ProjectsReports } from './projects.reports';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { BENEFICIARY_ENTITIES } from '../beneficiaries/entities';
import { FundraisingModule } from '../fundraising/fundraising.module';
import { PROJECT_ENTITIES } from './entities';
import { FundingGateway } from './funding.gateway';
import { InsightsService } from './insights.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { TransfersService } from './transfers.service';

/**
 * نظام إدارة المشاريع: الشجرة واعتماد المشاريع، إدارة الدعم على دفعات الداعمين،
 * الصرف المالي، المناقلات، تعديل فرص التبرع، لوحة المعلومات والتقارير.
 * يعتمد على المستفيدين (الشجرة والطلبات) والموارد المالية (الدفعات والقيود).
 */
@Module({
  imports: [TypeOrmModule.forFeature([...PROJECT_ENTITIES, ...BENEFICIARY_ENTITIES]), BeneficiariesModule, FundraisingModule],
  controllers: [SupportController, ProjectsController],
  providers: [ProjectsService, SupportService, TransfersService, InsightsService, FundingGateway, ProjectsReports],
  exports: [ProjectsService, SupportService, TransfersService],
})
export class ProjectsModule {}
