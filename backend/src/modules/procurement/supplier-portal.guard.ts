import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { ALLOW_TEMP_PASSWORD_KEY } from '../../core/auth/decorators';
import { orgAccessSql } from '../../core/organizations/org-access';
import { PortalRole, SupplierStatus } from './entities/procurement.entity';

export interface SupplierPortalUser {
  userId: string;
  supplierId: string;
  organizationId: string;
  fullName: string;
  email: string;
  role: PortalRole;
  supplierStatus: SupplierStatus;
  mustChangePassword: boolean;
}

/** حارس بوابة الموردين: رمز دخول من نوع supplier، والمستخدم نشط، والشركة متاحة */
@Injectable()
export class SupplierPortalGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly db: DataSource, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('سجّل الدخول لبوابة الموردين');
    let payload: { sub: string; typ?: string; iat?: number; ts?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('انتهت الجلسة، سجّل الدخول مرة أخرى');
    }
    if (payload.typ !== 'supplier') throw new UnauthorizedException('سجّل الدخول لبوابة الموردين');
    const [row] = await this.db.query(
      `SELECT u.id, u.supplier_id, u.organization_id, u.full_name, u.email, u.role, u.must_change_password AS must, u.sessions_valid_after AS valid_after, s.status
         FROM pr_supplier_users u JOIN pr_suppliers s ON s.id = u.supplier_id JOIN organizations o ON o.id = u.organization_id
        WHERE u.id = $1 AND u.is_active AND ${orgAccessSql('o')}`,
      [payload.sub],
    );
    if (!row) throw new UnauthorizedException('الحساب غير متاح');
    if (row.valid_after && (payload.ts ?? (payload.iat ?? 0) * 1000) < new Date(row.valid_after).getTime()) {
      throw new UnauthorizedException('انتهت الجلسة، سجّل الدخول مرة أخرى');
    }
    if (row.must && !this.reflector.getAllAndOverride<boolean>(ALLOW_TEMP_PASSWORD_KEY, [ctx.getHandler(), ctx.getClass()])) {
      throw new ForbiddenException('غيّر كلمة المرور المؤقتة أولًا، ثم تابع');
    }
    req.supplier = {
      userId: row.id, supplierId: row.supplier_id, organizationId: row.organization_id, fullName: row.full_name, email: row.email, role: row.role, supplierStatus: row.status,
      mustChangePassword: !!row.must,
    } satisfies SupplierPortalUser;
    return true;
  }
}

export const CurrentSupplier = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SupplierPortalUser => ctx.switchToHttp().getRequest().supplier,
);
