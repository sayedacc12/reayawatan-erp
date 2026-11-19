import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core.module';
import { BackupRun } from './backup-run.entity';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

/**
 * النسخ الاحتياطي: النسخ نفسه يشغّله سكربت deploy/backup.sh على السيرفر (مؤقت يومي)،
 * وهذه الوحدة تعرض نتائجه المسجلة في platform_backup_runs، وترسل تنبيهًا بالبريد للإدارة عند الفشل أو التأخر.
 */
@Module({
  imports: [TypeOrmModule.forFeature([BackupRun]), CoreModule],
  controllers: [BackupsController],
  providers: [BackupsService],
  exports: [BackupsService],
})
export class BackupsModule {}
