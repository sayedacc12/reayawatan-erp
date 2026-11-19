/** نفس قواعد الخادم: 8 أحرف على الأقل، إنجليزي وأرقام ورموز فقط */
const PASSWORD_CHARS = /^[\x21-\x7E]+$/;
const ARABIC = /[؀-ۿ]/;

export function passwordProblem(p: string): string {
  if (!p) return '';
  if (ARABIC.test(p)) return 'يجب أن تكون كلمة المرور بالأحرف الإنجليزية، وهي تحتوي على حروف عربية. غيّر لغة لوحة المفاتيح';
  if (/\s/.test(p)) return 'كلمة المرور لا تحتوي على مسافات';
  if (!PASSWORD_CHARS.test(p)) return 'كلمة المرور بالحروف الإنجليزية والأرقام والرموز فقط';
  if (p.length < 8) return `كلمة المرور قصيرة: ${p.length} من 8 أحرف على الأقل`;
  return '';
}

export const hasArabic = (s: string) => ARABIC.test(s);

/** كلمة مرور جديدة يختارها المستخدم بنفسه: نفس القواعد + حرف إنجليزي ورقم على الأقل */
export function strongPasswordProblem(p: string): string {
  const base = passwordProblem(p);
  if (base || !p) return base;
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'كلمة المرور الجديدة يجب أن تحتوي على حرف إنجليزي ورقم على الأقل';
  return '';
}
