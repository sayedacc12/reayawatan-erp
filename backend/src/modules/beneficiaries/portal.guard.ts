import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';

export interface PortalUser {
  beneficiaryId: string;
  organizationId: string;
  fullName: string;
}

/** حارس بوابة المستفيدين: رمز دخول من نوع portal، والمستفيد وجمعيته نشطين */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly db: DataSource) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('سجّل الدخول للبوابة');
    let payload: { sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('انتهت الجلسة، سجّل الدخول مرة أخرى');
    }
    if (payload.typ !== 'portal') throw new UnauthorizedException('سجّل الدخول للبوابة');
    const [row] = await this.db.query(
      `SELECT b.id, b.organization_id, b.full_name FROM beneficiaries b JOIN organizations o ON o.id = b.organization_id
       WHERE b.id = $1 AND o.is_active AND b.portal_password_hash IS NOT NULL`,
      [payload.sub],
    );
    if (!row) throw new UnauthorizedException('الحساب غير متاح');
    req.portal = { beneficiaryId: row.id, organizationId: row.organization_id, fullName: row.full_name } satisfies PortalUser;
    return true;
  }
}

export const CurrentPortalUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PortalUser => ctx.switchToHttp().getRequest().portal,
);
