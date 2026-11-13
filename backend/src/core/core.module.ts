import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { PermissionResolver } from './auth/permission-resolver.service';
import { BootstrapService } from './bootstrap.service';
import { CORE_ENTITIES } from './entities';
import { ModuleCatalogService } from './modules/module-catalog.service';
import { ModulesController } from './modules/modules.controller';
import { OrganizationsController } from './organizations/organizations.controller';
import { OrganizationsService } from './organizations/organizations.service';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/**
 * وحدة الأساس: الدخول الموحد، المستخدمون، الأدوار، الصلاحيات، وسجل الوحدات.
 * باقي الوحدات تستورد منها AuthUser و RequirePermissions فقط.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(CORE_ENTITIES),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') ?? '8h' },
      }),
    }),
  ],
  controllers: [AuthController, OrganizationsController, UsersController, RolesController, ModulesController],
  providers: [
    AuthService, PermissionResolver, ModuleCatalogService, RolesService, UsersService, OrganizationsService, BootstrapService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [ModuleCatalogService, PermissionResolver],
})
export class CoreModule {}
