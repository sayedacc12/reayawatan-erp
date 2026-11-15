import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from './decorators';
import { PermissionResolver } from './permission-resolver.service';

/**
 * حارس عام على كل الـ API:
 * 1) يتحقق من رمز الدخول (JWT) ما لم يكن المسار @Public
 * 2) يعيد تحميل المستخدم وصلاحياته من القاعدة في كل طلب، فإيقاف المستخدم
 *    أو سحب صلاحية يسري فورًا بدون انتظار انتهاء الرمز
 * 3) يتحقق من @RequirePermissions
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly resolver: PermissionResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('يجب تسجيل الدخول');

    let payload: { sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('انتهت الجلسة، سجّل الدخول مرة أخرى');
    }
    // رموز بوابة المستفيدين لا تصلح لنظام الموظفين
    if (payload.typ) throw new UnauthorizedException('يجب تسجيل الدخول');

    const user = await this.resolver.resolve(payload.sub);
    if (!user) throw new UnauthorizedException('الحساب غير موجود أو موقوف');
    req.user = user;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    if (!required.every((p) => user.permissions.includes(p))) {
      throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
    }
    return true;
  }
}
