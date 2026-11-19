import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { dataSourceOptions } from './config/data-source';
import { CoreModule } from './core/core.module';
import { ReportsModule } from './core/reports/reports.module';
import { TasksModule } from './core/tasks/tasks.module';
import { PerformanceModule } from './core/performance/performance.module';
import { BeneficiariesModule } from './modules/beneficiaries/beneficiaries.module';
import { FundraisingModule } from './modules/fundraising/fundraising.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { HrModule } from './modules/hr/hr.module';
import { RiskModule } from './modules/risk/risk.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { VolunteersModule } from './modules/volunteers/volunteers.module';
import { QualityModule } from './modules/quality/quality.module';
import { AuditModule } from './modules/audit/audit.module';
import { MembersModule } from './modules/members/members.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { WebsiteModule } from './modules/website/website.module';
import { PartnershipsModule } from './modules/partnerships/partnerships.module';
import { CommsModule } from './modules/comms/comms.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { PlanningModule } from './modules/planning/planning.module';
import { DemoModule } from './modules/demo/demo.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...dataSourceOptions(), migrationsRun: true }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ReportsModule,
    TasksModule,
    CoreModule,
    PerformanceModule,
    BeneficiariesModule,
    FundraisingModule,
    ProjectsModule,
    AccountingModule,
    HrModule,
    RiskModule,
    GovernanceModule,
    VolunteersModule,
    QualityModule,
    AuditModule,
    MembersModule,
    KnowledgeModule,
    PartnershipsModule,
    WebsiteModule,
    CommsModule,
    MeetingsModule,
    PlanningModule,
    DemoModule,
    // الوحدات القادمة تُضاف هنا: MembersModule, DonationsModule, ...
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
