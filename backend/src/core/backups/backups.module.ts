import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BackupRun } from './backup-run.entity';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

/**
 * النسخ الاحتياطي: النسخ نفسه يشغّله سكربت deploy/backup.sh على السيرفر (مؤقت يومي)،
 * وهذه الوحدة تعرض نتائجه المسجلة في platform_backup_runs.
 */
@Module({
  imports: [TypeOrmModule.forFeature([BackupRun])],
  controllers: [BackupsController],
  providers: [BackupsService],
  exports: [BackupsService],
})
export class BackupsModule {}
