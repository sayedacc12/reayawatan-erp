import { OrgUser } from '../../core/auth/decorators';

/** نتيجة خطوة واحدة: عدد ما أُضيف، وملاحظة اختيارية (مثل: «موجودة مسبقًا فلم تتغير») */
export interface StepOutcome { added: number; note?: string }

/**
 * خطوة في الإعدادات الافتراضية لنظام: تضيف ما ينقص فقط، ولا تعدّل ولا تحذف شيئًا أدخلته الشركة.
 * كل خطوة آمنة للتكرار: إن توقفت العملية في منتصفها تُعاد من أولها دون تكرار ما أُضيف.
 */
export interface StarterStep {
  key: string;
  /** ما يظهر للمستخدم قبل الإضافة، مثل «مراحل اعتماد سندات القبض والصرف» */
  label: string;
  /** شرح قصير لما ستضيفه الخطوة */
  detail: string;
  run(actor: OrgUser): Promise<StepOutcome>;
}

/** الإعدادات الافتراضية لنظام واحد (كود النظام كما في manifest) */
export interface StarterPack {
  module: string;
  steps: StarterStep[];
}

export const added = (n: number, note?: string): StepOutcome => ({ added: n, ...(note ? { note } : {}) });
export const existing = (what = 'موجودة مسبقًا'): StepOutcome => ({ added: 0, note: `${what}، فلم تتغير` });
