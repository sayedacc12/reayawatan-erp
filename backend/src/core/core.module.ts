import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { PasswordReset } from './auth/password-reset.entity';
import { PasswordResetService } from './auth/password-reset.service';
import { CoreTasks } from './auth/core.tasks';
import { PermissionResolver } from './auth/permission-resolver.service';
import { BootstrapService } from './bootstrap.service';
import { CORE_ENTITIES } from './entities';
import { FileStore } from './files/file-store.service';
import { IdentityController, PublicIdentityController } from './identity/identity.controller';
import { IdentityService } from './identity/identity.service';
import { OrganizationClosure } from './lifecycle/closure.entity';
import { OrgLifecycleController, PlatformLifecycleController } from './lifecycle/lifecycle.controller';
import { LifecycleService } from './lifecycle/lifecycle.service';
import { LookupsController } from './lookups/lookups.controller';
import { LookupsService } from './lookups/lookups.service';
import { ApplicationsService } from './subscriptions/applications.service';
import { ContractsService } from './subscriptions/contracts.service';
import { SUBSCRIPTION_ENTITIES } from './subscriptions/entities';
import { OrgSupportController, SupportDeskController } from './support/support.controller';
import { SupportDeskService } from './support/support-desk.service';
import { SUPPORT_ENTITIES } from './support/support.entity';
import { SupportReports } from './support/support.reports';
import { SupportService } from './support/support.service';
import { SubscriptionsReports } from './subscriptions/subscriptions.reports';
import { RegistrationController } from './subscriptions/registration.controller';
import { SubscriptionReportsService } from './subscriptions/reports.service';
import { SubscriptionReportsController, SubscriptionsController } from './subscriptions/subscriptions.controller';
import { PlatformSiteController, PublicSiteController } from './site/site.controller';
import { SiteInquiry } from './site/site.entity';
import { SiteService } from './site/site.service';
import { ModuleCatalogService } from './modules/module-catalog.service';
import { ModulesController } from './modules/modules.controller';
import { OrganizationsController } from './organizations/organizations.controller';
import { OrganizationsService } from './organizations/organizations.service';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { OnboardingController } from './onboarding/onboarding.controller';
import { UserOnboarding } from './onboarding/onboarding.entity';
import { OnboardingService } from './onboarding/onboarding.service';
import { MailController } from './mail/mail.controller';
import { MailMessage } from './mail/mail-outbox.entity';
import { MailService } from './mail/mail.service';
import { isSingleCompany } from './company';

/**
 * وحدة الأساس: الدخول الموحد، المستخدمون، الأدوار، الصلاحيات، وسجل الوحدات.
 * باقي الوحدات تستورد منها AuthUser و RequirePermissions فقط.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([...CORE_ENTITIES, ...SUBSCRIPTION_ENTITIES, ...SUPPORT_ENTITIES, SiteInquiry, UserOnboarding, OrganizationClosure, PasswordReset, MailMessage]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') ?? '8h' },
      }),
    }),
  ],
  controllers: [
    AuthController, OrganizationsController, UsersController, RolesController, ModulesController,
    SubscriptionsController, SubscriptionReportsController, ...(isSingleCompany() ? [] : [RegistrationController]), OrgSupportController, SupportDeskController, LookupsController, IdentityController, PublicIdentityController,
    // وضع الشركة الواحدة: لا تسجيل جمعيات ولا نموذج طلبات للصفحة التعريفية للمنصة
    ...(isSingleCompany() ? [] : [PublicSiteController]), PlatformSiteController, OnboardingController, OrgLifecycleController, PlatformLifecycleController, MailController,
  ],
  providers: [
    AuthService, PasswordResetService, CoreTasks, PermissionResolver, ModuleCatalogService, RolesService, UsersService, OrganizationsService, BootstrapService,
    FileStore, ContractsService, ApplicationsService, SubscriptionReportsService, SupportService, SupportDeskService, LookupsService, SubscriptionsReports, SupportReports, IdentityService, SiteService, OnboardingService, LifecycleService, MailService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PasswordResetService, ModuleCatalogService, PermissionResolver, FileStore, ContractsService, ApplicationsService, LookupsService, SupportService, SupportDeskService, IdentityService, MailService],
})
export class CoreModule {}
