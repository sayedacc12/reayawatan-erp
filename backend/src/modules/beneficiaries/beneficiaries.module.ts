import { BeneficiariesReports } from './beneficiaries.reports';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { BeneficiariesController } from './beneficiaries.controller';
import { BeneficiariesService } from './beneficiaries.service';
import { DocumentStorage } from './document-storage.service';
import { BENEFICIARY_ENTITIES } from './entities';
import { PortalController } from './portal.controller';
import { PortalGuard } from './portal.guard';
import { PortalService } from './portal.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/**
 * وحدة المستفيدين: الملفات والأسر، شجرة الأنشطة، سير عمل الطلبات بمراحله ونماذجه،
 * بوابة المستفيدين، والشكاوى والمقترحات.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(BENEFICIARY_ENTITIES),
    // قائمة الجنسيات المشتركة (LookupsService)
    CoreModule,
    // رموز البوابة بنفس سر النظام لكن بنوع portal، وحارس الموظفين يرفضها
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  // المسارات الأكثر تحديدًا أولًا: beneficiaries/settings و beneficiaries/requests قبل beneficiaries/:id
  controllers: [SettingsController, RequestsController, TicketsController, BeneficiariesController, PortalController],
  providers: [BeneficiariesService, DocumentStorage, SettingsService, RequestsService, TicketsService, PortalService, PortalGuard, BeneficiariesReports],
  // للوحدات القادمة (مثل المالية) لربط الصرف بالقيود والمشاريع
  exports: [BeneficiariesService, RequestsService, SettingsService, DocumentStorage],
})
export class BeneficiariesModule {}
