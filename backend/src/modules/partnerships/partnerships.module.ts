import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { PtContractsService } from './contracts.service';
import { PARTNERSHIP_ENTITIES } from './entities/partnerships.entity';
import { PartnershipsController, PublicPartnershipsController } from './partnerships.controller';
import { PartnershipsReports } from './partnerships.reports';
import { PartnershipsService } from './partnerships.service';
import { PartnershipsTasks } from './partnerships.tasks';

/**
 * نظام الشراكات: معايير اختيار الشركاء وأنواع الشراكة وتصنيفات الشركاء، والتقييم والاعتماد،
 * وعقود الشراكة من مكتبة بنود مبوبة مع التوقيع الإلكتروني والإصدارات، ومتابعة الالتزامات والتنبيهات.
 * يقرأ المانحين من تنمية الموارد والمشاريع من نظام المشاريع، ويغذي صفحة الشركاء في الموقع الإلكتروني.
 */
@Module({
  imports: [TypeOrmModule.forFeature(PARTNERSHIP_ENTITIES), CoreModule],
  controllers: [PartnershipsController, PublicPartnershipsController],
  providers: [PartnershipsService, PtContractsService, PartnershipsReports, PartnershipsTasks],
  exports: [PartnershipsService, PtContractsService],
})
export class PartnershipsModule {}
