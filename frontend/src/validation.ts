/** نفس قواعد الخادم: 8 أحرف على الأقل، إنجليزي وأرقام ورموز فقط */
const PASSWORD_CHARS = /^[\x21-\x7E]+$/;
const ARABIC = /[؀-ۿ]/;

export function passwordProblem(p: string): string {
  if (!p) return '';
  if (ARABIC.test(p)) return 'كلمة المرور لازم تكون بالإنجليزي، وفيها حروف عربية. غيّر لغة الكيبورد';
  if (/\s/.test(p)) return 'كلمة المرور لا تحتوي على مسافات';
  if (!PASSWORD_CHARS.test(p)) return 'كلمة المرور بالحروف الإنجليزية والأرقام والرموز فقط';
  if (p.length < 8) return `كلمة المرور قصيرة: ${p.length} من 8 أحرف على الأقل`;
  return '';
}

export const hasArabic = (s: string) => ARABIC.test(s);
