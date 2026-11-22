import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { BookingService } from './booking.service';
import { ContentService } from './content.service';
import { WEBSITE_ENTITIES } from './entities/website.entity';
import { FormsService } from './forms.service';
import { GuidesService } from './guides.service';
import { LeadsService } from './leads.service';
import { PublicSiteController, WebsiteController } from './website.controller';
import { WebsiteTasks } from './website.tasks';

/** الموقع الإلكتروني لرعاية وطن: المحتوى، والعملاء المحتملون من كل النماذج، والحجز، ومكتبة الأدلة */
@Module({
  imports: [TypeOrmModule.forFeature(WEBSITE_ENTITIES), CoreModule],
  controllers: [WebsiteController, PublicSiteController],
  providers: [ContentService, LeadsService, FormsService, BookingService, GuidesService, WebsiteTasks],
  exports: [ContentService, LeadsService, FormsService, BookingService, GuidesService],
})
export class WebsiteModule {}
