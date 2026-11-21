import { DataSource, EntityManager } from 'typeorm';

/** أنواع الرسائل التي يمكن لمدير المنصة إيقافها أو تشغيلها */
export const MAIL_EVENTS = {
  contracts: 'إرسال رابط العقد للجمعية',
  accounts: 'بيانات دخول مدير نظام الجمعية (عند الاعتماد وكلمة المرور المؤقتة)',
  lifecycle: 'تذكيرات انتهاء التجربة وحذف البيانات',
  inquiries: 'إشعار الإدارة بطلبات الخدمات الجديدة',
  inquiryAck: 'رسالة تأكيد لمقدم طلب الخدمة',
  passwordReset: 'استعادة كلمة المرور',
  backups: 'تنبيه الإدارة عند فشل النسخ الاحتياطي أو تأخره',
  suppliers: 'إشعارات بوابة الموردين (الحسابات والاعتماد والمستندات)',
  security: 'تنبيهات المراقب الأمني «سيد» وتقريره اليومي',
} as const;
export type MailEvent = keyof typeof MAIL_EVENTS;

/** إعدادات البريد في platform_settings (المفتاح mail). كلمة مرور الخادم لا تُحفظ هنا أبدًا بل في ملف .env */
export interface MailSettings {
  enabled: boolean;
  senderName: string;
  replyTo: string | null;
  /** عناوين تستقبل إشعارات الإدارة (فارغة = بريد الإرسال نفسه) */
  adminEmails: string[];
  /** الحد اليومي لعدد الرسائل (Gmail يسمح بحوالي 500 يوميًا) */
  dailyLimit: number;
  events: Record<MailEvent, boolean>;
}

export const DEFAULT_MAIL_SETTINGS: MailSettings = {
  enabled: true,
  senderName: 'سنابل',
  replyTo: null,
  adminEmails: [],
  dailyLimit: 450,
  events: Object.fromEntries(Object.keys(MAIL_EVENTS).map((k) => [k, true])) as Record<MailEvent, boolean>,
};

export async function mailSettings(db: DataSource | EntityManager): Promise<MailSettings> {
  const [row] = await db.query(`SELECT value FROM platform_settings WHERE key = 'mail'`);
  const v = (row?.value ?? {}) as Partial<MailSettings>;
  return { ...DEFAULT_MAIL_SETTINGS, ...v, events: { ...DEFAULT_MAIL_SETTINGS.events, ...(v.events ?? {}) } };
}

/** إعدادات الخادم من متغيرات البيئة (لا تظهر كلمة المرور لأي أحد) */
export interface SmtpEnv {
  mode: 'smtp' | 'test' | 'off';
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string | null;
}

export function smtpEnv(env = process.env): SmtpEnv {
  if (env.MAIL_TRANSPORT === 'test') {
    return { mode: 'test', host: 'test', port: 0, secure: false, user: null, pass: null, from: env.MAIL_FROM || 'test@sanabelerp.com' };
  }
  const user = env.SMTP_USER?.trim() || null;
  const host = env.SMTP_HOST?.trim() || (user?.toLowerCase().endsWith('@gmail.com') ? 'smtp.gmail.com' : null);
  const port = Number(env.SMTP_PORT) || 465;
  // كلمة مرور تطبيقات Gmail تُعرض بمسافات (xxxx xxxx xxxx xxxx)، فنحذفها
  const pass = env.SMTP_PASS?.replace(/\s+/g, '') || null;
  const from = env.MAIL_FROM?.trim() || user;
  const ready = !!(host && from && (!user || pass));
  return {
    mode: ready ? 'smtp' : 'off', host, port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    user, pass, from,
  };
}

/** يخفي جزءًا من البريد للعرض: sa***@gmail.com */
export const maskEmail = (e: string | null) => {
  if (!e) return null;
  const [name, domain] = e.split('@');
  return domain ? `${name.slice(0, 2)}${'*'.repeat(Math.max(3, name.length - 2))}@${domain}` : e;
};

export const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
