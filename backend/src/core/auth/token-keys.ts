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

/** خيارات JwtModule لنوع رمز معين: المفتاح من JWT_SECRET في البيئة دائمًا، مشتقًا حسب النوع */
const BASE_ENV = 'JWT_SECRET';
export const jwtOptionsFor = (kind: TokenKind) => (config: { getOrThrow<T = string>(key: string): T }) => {
  const base = config.getOrThrow<string>(BASE_ENV);
  return { secret: tokenSecret(base, kind) };
};
