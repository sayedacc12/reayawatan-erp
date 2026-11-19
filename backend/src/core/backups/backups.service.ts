import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { templates } from '../mail/mail-templates';
import { BackupRun } from './backup-run.entity';

/** إذا مرّت هذه المدة دون نسخة ناجحة تُعدّ الوجهة متأخرة (النسخ يومي، مع هامش) */
export const STALE_HOURS = 30;
/** تجربة الاسترجاع أسبوعية، فإن مرّ أكثر من هذه المدة دونها نُنبّه */
export const VERIFY_STALE_DAYS = 9;
const HOUR_MS = 3_600_000;
/** فحص الحالة لإرسال التنبيه بالبريد */
const CHECK_EVERY_MS = HOUR_MS;

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

const fmt = (d: Date) => d.toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' });

@Injectable()
export class BackupsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Backups');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(BackupRun) private readonly runs: Repository<BackupRun>,
    private readonly mail: MailService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.JEST_WORKER_ID) return;
    this.timer = setInterval(() => void this.alert().catch((e) => this.logger.error(`Backup alert failed: ${(e as Error).message}`)), CHECK_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * يرسل لعناوين الإدارة رسالة واحدة لكل مشكلة: فشل نسخة، أو تأخرها، أو فشل تجربة الاسترجاع.
   * مفتاح منع التكرار مربوط بآخر محاولة، فلا تتكرر الرسالة كل ساعة لنفس المشكلة.
   */
  async alert() {
    const o = await this.overview();
    const to = await this.mail.adminRecipients();
    const sent: string[] = [];
    for (const t of o.targets) {
      const issues: { key: string; problem: string; detail?: string | null }[] = [];
      if (t.health === 'failed' && t.lastAttempt) issues.push({ key: `failed:${t.lastAttempt.id}`, problem: 'فشلت آخر نسخة', detail: t.lastAttempt.message });
      if (t.health === 'stale') issues.push({ key: `stale:${t.lastSuccess?.id ?? 'none'}`, problem: `لم تُؤخذ نسخة منذ أكثر من ${STALE_HOURS} ساعة` });
      if (t.lastVerify?.status === 'failed') issues.push({ key: `verify:${t.lastVerify.id}`, problem: 'فشلت تجربة استرجاع آخر نسخة', detail: t.lastVerify.message });
      for (const i of issues) {
        sent.push(...await this.mail.queue({
          to, kind: 'backup_alert', event: 'backups', createdBy: 'مراقبة النسخ الاحتياطي', dedupeKey: `backup:${t.code}:${i.key}`,
          ...templates.backupAlert({ target: t.name, problem: i.problem, detail: i.detail, lastSuccess: t.lastSuccess ? fmt(new Date(t.lastSuccess.startedAt)) : 'لا يوجد' }),
        }));
      }
    }
    return sent;
  }

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
