import { DataSource, EntityManager } from 'typeorm';

/** إعدادات المراقب الأمني في platform_settings (المفتاح security) */
export interface SecuritySettings {
  enabled: boolean;
  /** مستلمو التنبيهات والتقرير (فارغة = عناوين إشعارات الإدارة في إعدادات البريد) */
  recipients: string[];
  /** الإجراءات التلقائية الموضعية: حظر عنوان مهاجم مؤقتًا، وإنهاء جلسة حساب مشبوه */
  autoActions: boolean;
  dailyReport: boolean;
  /** ساعة إرسال التقرير اليومي بتوقيت الرياض */
  dailyHour: number;
  /** مدة الحظر التلقائي بالدقائق */
  blockMinutes: number;
  /** عناوين لا تُحظر أبدًا (مثل عنوان مكتب الجمعية أو مدير المنصة) */
  trustedIps: string[];
  thresholds: {
    /** محاولات دخول فاشلة من عنوان واحد خلال 10 دقائق */
    bruteForce: number;
    /** طلبات مرفوضة أو لمسارات غير موجودة من عنوان واحد خلال 5 دقائق */
    scan: number;
    /** طلبات مرفوضة أو لسجلات غير موجودة من حساب واحد خلال 10 دقائق */
    probe: number;
    /** عمليات تصدير من حساب واحد خلال ساعة */
    exports: number;
    /** أخطاء خادم خلال 10 دقائق */
    errors: number;
  };
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  enabled: true,
  recipients: [],
  autoActions: true,
  dailyReport: true,
  dailyHour: 7,
  blockMinutes: 60,
  trustedIps: [],
  thresholds: { bruteForce: 10, scan: 40, probe: 20, exports: 30, errors: 20 },
};

export async function securitySettings(db: DataSource | EntityManager): Promise<SecuritySettings> {
  const [row] = await db.query(`SELECT value FROM platform_settings WHERE key = 'security'`);
  const v = (row?.value ?? {}) as Partial<SecuritySettings>;
  return { ...DEFAULT_SECURITY_SETTINGS, ...v, thresholds: { ...DEFAULT_SECURITY_SETTINGS.thresholds, ...(v.thresholds ?? {}) } };
}

/** عناوين لا تُحظر تلقائيًا: الجهاز نفسه والشبكات الخاصة (الوسطاء داخل Docker) */
export function isPrivateIp(ip: string | null | undefined) {
  if (!ip) return true;
  const v = ip.replace(/^::ffff:/, '');
  return v === '::1' || v.startsWith('127.') || v.startsWith('10.') || v.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(v) || v.startsWith('169.254.') || /^f[cd][0-9a-f]{2}:/i.test(v) || /^fe80:/i.test(v);
}

export const normIp = (ip: string | null | undefined) => (ip ? ip.replace(/^::ffff:/, '').slice(0, 64) : null);
