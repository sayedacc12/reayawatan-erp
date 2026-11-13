import { createParamDecorator, ForbiddenException, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'erp:isPublic';
export const PERMISSIONS_KEY = 'erp:permissions';

/** مسار لا يحتاج تسجيل دخول (مثل شاشة الدخول نفسها) */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** يتطلب أن يملك المستخدم كل الصلاحيات المذكورة */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);

export interface AuthUser {
  id: string;
  /** null لمدير المنصة فقط */
  organizationId: string | null;
  organizationName: string | null;
  email: string;
  username: string | null;
  fullName: string;
  isSuperadmin: boolean;
  isPlatformAdmin: boolean;
  permissions: string[];
}

/** مستخدم داخل جمعية: organizationId مضمون */
export type OrgUser = AuthUser & { organizationId: string };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

/**
 * المستخدم الحالي داخل جمعيته. يُستخدم في كل endpoints الوحدات؛
 * يرفض الطلب لو المستخدم مدير منصة بدون جمعية، فلا يمكن تمرير طلب بدون نطاق جمعية.
 */
export const CurrentOrgUser = createParamDecorator((_: unknown, ctx: ExecutionContext): OrgUser => {
  const user: AuthUser = ctx.switchToHttp().getRequest().user;
  if (!user?.organizationId) throw new ForbiddenException('هذا الإجراء داخل جمعية فقط');
  return user as OrgUser;
});
