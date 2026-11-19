import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_TEMP_PASSWORD_KEY } from '../../core/auth/decorators';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { orgAccessSql } from '../../core/organizations/org-access';

export interface PortalUser {
  beneficiaryId: string;
  organizationId: string;
  fullName: string;
}

/** حارس بوابة المستفيدين: رمز دخول من نوع portal، والمستفيد وجمعيته نشطين */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly db: DataSource, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('سجّل الدخول للبوابة');
    let payload: { sub: string; typ?: string; iat?: number; ts?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('انتهت الجلسة، سجّل الدخول مرة أخرى');
    }
    if (payload.typ !== 'portal') throw new UnauthorizedException('سجّل الدخول للبوابة');
    const [row] = await this.db.query(
      `SELECT b.id, b.organization_id, b.full_name, b.portal_must_change_password AS must, b.portal_sessions_valid_after AS valid_after
         FROM beneficiaries b JOIN organizations o ON o.id = b.organization_id
       WHERE b.id = $1 AND ${orgAccessSql('o')} AND b.portal_password_hash IS NOT NULL`,
      [payload.sub],
    );
    if (!row) throw new UnauthorizedException('الحساب غير متاح');
    // سلّمت الجمعية كلمة مؤقتة بعد هذا الدخول: تنتهي الجلسات القديمة
    if (row.valid_after && (payload.ts ?? (payload.iat ?? 0) * 1000) < new Date(row.valid_after).getTime()) {
      throw new UnauthorizedException('انتهت الجلسة، سجّل الدخول مرة أخرى');
    }
    if (row.must && !this.reflector.getAllAndOverride<boolean>(ALLOW_TEMP_PASSWORD_KEY, [ctx.getHandler(), ctx.getClass()])) {
      throw new ForbiddenException('غيّر كلمة المرور المؤقتة أولًا، ثم تابع');
    }
    req.portal = { beneficiaryId: row.id, organizationId: row.organization_id, fullName: row.full_name } satisfies PortalUser;
    return true;
  }
}

export const CurrentPortalUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PortalUser => ctx.switchToHttp().getRequest().portal,
);
