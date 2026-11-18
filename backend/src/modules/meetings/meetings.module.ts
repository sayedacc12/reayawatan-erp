import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { CommsModule } from '../comms/comms.module';
import { MEETINGS_ENTITIES } from './entities/meetings.entity';
import { MeetingsInsights } from './insights.service';
import { MeetingsController, PublicMinutesController } from './meetings.controller';
import { MeetingsCore } from './meetings-core.service';
import { MeetingsReports } from './meetings.reports';
import { MeetingsService } from './meetings.service';
import { MeetingsBell } from './meetings.tasks';
import { MinutesService } from './minutes.service';

/**
 * الاجتماعات واللجان: الجمعية العمومية (أعضاؤها من نظام العضوية)، مجلس الإدارة، اللجان، فرق العمل (من الهيكل التنظيمي).
 * توصيات المحاضر المعتمدة تتحول إلى مهام عبر TasksService في نظام الاتصالات الإدارية.
 */
@Module({
  imports: [TypeOrmModule.forFeature(MEETINGS_ENTITIES), CoreModule, CommsModule],
  controllers: [MeetingsController, PublicMinutesController],
  providers: [MeetingsCore, MeetingsService, MinutesService, MeetingsInsights, MeetingsReports, MeetingsBell],
  exports: [MeetingsCore, MeetingsService, MinutesService],
})
export class MeetingsModule {}
