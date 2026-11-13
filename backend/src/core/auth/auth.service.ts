import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../entities';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { AuthUser } from './decorators';
import { PermissionResolver } from './permission-resolver.service';

// يستخدم عند عدم وجود المستخدم حتى يأخذ الرفض نفس الوقت تقريبًا
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly resolver: PermissionResolver,
    private readonly catalog: ModuleCatalogService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findOne({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, passwordHash: true },
    });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }
    // يتحقق من أن الحساب والجمعية نشطان
    if (!(await this.resolver.resolve(user.id))) {
      throw new UnauthorizedException('الحساب أو الجمعية موقوف، تواصل مع الإدارة');
    }
    await this.users.update(user.id, { lastLoginAt: new Date() });
    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, ...(await this.session(user.id)) };
  }

  /** بيانات الجلسة: المستخدم + صلاحياته + الوحدات المتاحة له وقوائمها */
  async session(userId: string) {
    const user = (await this.resolver.resolve(userId)) as AuthUser;
    return { user, apps: this.catalog.appsFor(user.permissions) };
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    }
    await this.users.update(user.id, { passwordHash: await bcrypt.hash(next, 12) });
  }
}
