import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type BackupTarget = 'oracle' | 'gdrive' | 'none';
/** daily/weekly: النسخة المجدولة، pre-restore: نسخة أمان قبل استرجاع، verify: تجربة استرجاع، restore: استرجاع فعلي */
export type BackupKind = 'daily' | 'weekly' | 'pre-restore' | 'verify' | 'restore';

/** نتيجة تشغيل واحدة لسكربت النسخ الاحتياطي (يكتبها deploy/backup.sh مباشرة في القاعدة) */
@Entity('platform_backup_runs')
@Index('IDX_platform_backup_runs_started', ['startedAt'])
export class BackupRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 20 })
  target!: BackupTarget;

  @Column({ length: 20 })
  kind!: BackupKind;

  @Column({ length: 10 })
  status!: 'success' | 'failed';

  /** اسم النسخة (تاريخها ووقتها بتوقيت الرياض) */
  @Column({ type: 'varchar', length: 40, nullable: true })
  stamp!: string | null;

  @Column({ name: 'db_bytes', type: 'bigint', nullable: true })
  dbBytes!: string | null;

  @Column({ name: 'files_bytes', type: 'bigint', nullable: true })
  filesBytes!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz' })
  finishedAt!: Date;

  @Column({ type: 'text', nullable: true })
  message!: string | null;
}
