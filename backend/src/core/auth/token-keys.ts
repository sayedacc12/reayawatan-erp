import { createHmac } from 'crypto';

/**
 * مفتاح توقيع مستقل لكل نوع رمز دخول، مشتق من JWT_SECRET (لا حاجة لمتغير بيئة جديد).
 * staff يبقى JWT_SECRET نفسه حتى لا تنتهي جلسات الموظفين عند التحديث.
 * فلا يمكن لرمز بوابة المستفيدين أو الموردين أن يُقبل في غير بوابته حتى لو أخطأ حارس في فحص typ.
 */
export type TokenKind = 'staff' | 'portal' | 'supplier';

export function tokenSecret(base: string, kind: TokenKind): string {
  if (!base) throw new Error('JWT_SECRET must be set');
  return kind === 'staff' ? base : createHmac('sha256', base).update(`sanabel:jwt:${kind}`).digest('base64url');
}
