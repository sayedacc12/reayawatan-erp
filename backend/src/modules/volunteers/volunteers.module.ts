import { VolunteersReports } from './volunteers.reports';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VOL_ENTITIES } from './entities/volunteers.entity';
import { EventsService } from './events.service';
import { PublicVolunteersController, VolunteersController } from './volunteers.controller';
import { VolunteersService } from './volunteers.service';
import { VolCore } from './vol-core.service';
import { VolReportsService } from './vol-reports.service';

/**
 * التطوع: سجل المتطوعين بنموذج مرن، الفعاليات الميدانية وعن بعد بمراحل اعتماد، الساعات والشهادات، العقود،
 * اللائحة والميثاق، استبانات الرضا، والشكاوى والمقترحات. مستقلة عن باقي الوحدات حاليًا.
 */
@Module({
  imports: [TypeOrmModule.forFeature(VOL_ENTITIES)],
  controllers: [VolunteersController, PublicVolunteersController],
  providers: [VolCore, VolunteersService, EventsService, VolReportsService, VolunteersReports],
  exports: [VolCore, VolunteersService, EventsService, VolReportsService, VolunteersReports],
})
export class VolunteersModule {}
