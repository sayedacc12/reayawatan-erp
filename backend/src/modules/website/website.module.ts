import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ContentService } from './content.service';
import { WEBSITE_ENTITIES } from './entities/website.entity';
import { SiteService } from './site.service';
import { StoreService } from './store.service';
import { WebCore } from './web-core.service';
import { PublicWebsiteController, WebsiteController } from './website.controller';
import { WebsiteReports } from './website.reports';

/**
 * الموقع الإلكتروني لكل جمعية ولوحة تحكمه: الصفحات والأخبار والبرامج والحوكمة والشركاء ورسائل الزوار،
 * ومتجر التبرعات بالدفع الإلكتروني والإيصالات والتبرع الشهري والإهداء، مع سند قبض في النظام المالي لكل تبرع.
 * يقرأ هوية الجمعية من الأساس، والوثائق العامة من أرشيف المعرفة.
 */
@Module({
  imports: [TypeOrmModule.forFeature(WEBSITE_ENTITIES), CoreModule, AccountingModule, KnowledgeModule],
  controllers: [WebsiteController, PublicWebsiteController],
  providers: [WebCore, ContentService, StoreService, SiteService, WebsiteReports],
  exports: [WebCore, ContentService, StoreService, SiteService],
})
export class WebsiteModule {}
