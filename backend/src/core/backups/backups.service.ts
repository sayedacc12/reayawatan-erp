import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BackupRun } from './backup-run.entity';

/** إذا مرّت هذه المدة دون نسخة ناجحة تُعدّ الوجهة متأخرة (النسخ يومي، مع هامش) */
export const STALE_HOURS = 30;
/** تجربة الاسترجاع أسبوعية، فإن مرّ أكثر من هذه المدة دونها نُنبّه */
export const VERIFY_STALE_DAYS = 9;
const HOUR_MS = 3_600_000;

const TARGETS = [
  { code: 'oracle', name: 'Oracle Object Storage' },
  { code: 'gdrive', name: 'Google Drive' },
] as const;

type Health = 'ok' | 'stale' | 'failed' | 'off';

const view = (r: BackupRun | null | undefined) =>
  r && {
    id: r.id, target: r.target, kind: r.kind, status: r.status, stamp: r.stamp, message: r.message,
    dbBytes: r.dbBytes === null ? null : Number(r.dbBytes),
    filesBytes: r.filesBytes === null ? null : Number(r.filesBytes),
    startedAt: r.startedAt, finishedAt: r.finishedAt,
  };

@Injectable()
export class BackupsService {
  constructor(@InjectRepository(BackupRun) private readonly runs: Repository<BackupRun>) {}

  async overview() {
    const now = Date.now();
    const targets = await Promise.all(
      TARGETS.map(async ({ code, name }) => {
        const [lastAttempt, lastSuccess, lastVerify] = await Promise.all([
          this.runs.findOne({ where: { target: code, kind: In(['daily', 'weekly']) }, order: { startedAt: 'DESC' } }),
          this.runs.findOne({ where: { target: code, kind: In(['daily', 'weekly']), status: 'success' }, order: { startedAt: 'DESC' } }),
          this.runs.findOne({ where: { target: code, kind: 'verify' }, order: { startedAt: 'DESC' } }),
        ]);
        let health: Health = 'off';
        if (lastAttempt) {
          if (lastAttempt.status === 'failed') health = 'failed';
          else if (!lastSuccess || now - lastSuccess.startedAt.getTime() > STALE_HOURS * HOUR_MS) health = 'stale';
          else health = 'ok';
        }
        const verifyWarning =
          health !== 'off' &&
          (!lastVerify || lastVerify.status === 'failed' || now - lastVerify.startedAt.getTime() > VERIFY_STALE_DAYS * 24 * HOUR_MS);
        return { code, name, health, verifyWarning, lastAttempt: view(lastAttempt), lastSuccess: view(lastSuccess), lastVerify: view(lastVerify) };
      }),
    );
    const active = targets.filter((t) => t.health !== 'off');
    const overall: Health | 'alert' = !active.length ? 'off' : active.every((t) => t.health === 'ok') ? 'ok' : 'alert';
    const history = await this.runs.find({ order: { startedAt: 'DESC' }, take: 60 });
    return { overall, staleHours: STALE_HOURS, targets, history: history.map(view) };
  }
}
