import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { CommsModule } from '../comms/comms.module';
import { GovernanceModule } from '../governance/governance.module';
import { HrModule } from '../hr/hr.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { MembersModule } from '../members/members.module';
import { PartnershipsModule } from '../partnerships/partnerships.module';
import { PlanningModule } from '../planning/planning.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { QualityModule } from '../quality/quality.module';
import { RiskModule } from '../risk/risk.module';
import { VolunteersModule } from '../volunteers/volunteers.module';
import { AccountingStarter } from './packs/accounting.pack';
import { AuditStarter } from './packs/audit.pack';
import { BillingStarter } from './packs/billing.pack';
import { GovernanceStarter } from './packs/governance.pack';
import { HrStarter } from './packs/hr.pack';
import { MeetingsStarter } from './packs/meetings.pack';
import { ProcurementStarter } from './packs/procurement.pack';
import { QualityStarter } from './packs/quality.pack';
import { RiskStarter } from './packs/risk.pack';
import { CommsStarter, KnowledgeStarter, MembersStarter, PartnershipsStarter, PlanningStarter, VolunteersStarter } from './packs/simple.packs';
import { StarterController } from './starter.controller';
import { OrganizationStarter } from './starter.entity';
import { STARTER_PACKS, StarterService } from './starter.service';

/**
 * الإعدادات الافتراضية لكل نظام، مكيّفة لشركة استشارية (رعاية وطن). لإضافة نظام جديد: اكتب ملف packs/<النظام>.pack.ts
 * وأضفه إلى PACKS هنا، وأضف <StarterSettings module="..."> في شاشة إعداداته.
 * الموقع الإلكتروني لا يحتاج زرًا: محتواه الافتراضي يُعرض تلقائيًا حتى يُعدَّل (website-defaults.ts).
 */
const PACKS = [
  AccountingStarter, BillingStarter, HrStarter, ProcurementStarter, RiskStarter, AuditStarter, QualityStarter, GovernanceStarter,
  MeetingsStarter, VolunteersStarter, MembersStarter, PartnershipsStarter, CommsStarter, KnowledgeStarter, PlanningStarter,
];

@Module({
  imports: [
    CoreModule, AccountingModule, AuditModule, BillingModule, CommsModule, GovernanceModule, HrModule, KnowledgeModule, MeetingsModule,
    MembersModule, PartnershipsModule, PlanningModule, ProcurementModule, QualityModule, RiskModule, VolunteersModule,
    TypeOrmModule.forFeature([OrganizationStarter]),
  ],
  controllers: [StarterController],
  providers: [...PACKS, StarterService, { provide: STARTER_PACKS, useFactory: (...packs: unknown[]) => packs, inject: PACKS }],
})
export class StarterModule {}
