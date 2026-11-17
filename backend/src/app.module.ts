import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { dataSourceOptions } from './config/data-source';
import { CoreModule } from './core/core.module';
import { BeneficiariesModule } from './modules/beneficiaries/beneficiaries.module';
import { FundraisingModule } from './modules/fundraising/fundraising.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { HrModule } from './modules/hr/hr.module';
import { RiskModule } from './modules/risk/risk.module';
import { VolunteersModule } from './modules/volunteers/volunteers.module';
import { QualityModule } from './modules/quality/quality.module';
import { MembersModule } from './modules/members/members.module';
import { DemoModule } from './modules/demo/demo.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...dataSourceOptions(), migrationsRun: true }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    CoreModule,
    BeneficiariesModule,
    FundraisingModule,
    ProjectsModule,
    AccountingModule,
    HrModule,
    RiskModule,
    VolunteersModule,
    QualityModule,
    MembersModule,
    DemoModule,
    // الوحدات القادمة تُضاف هنا: MembersModule, DonationsModule, ...
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
