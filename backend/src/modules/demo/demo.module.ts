import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AuditModule } from '../audit/audit.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { FundraisingModule } from '../fundraising/fundraising.module';
import { HrModule } from '../hr/hr.module';
import { MembersModule } from '../members/members.module';
import { ProjectsModule } from '../projects/projects.module';
import { RiskModule } from '../risk/risk.module';
import { VolunteersModule } from '../volunteers/volunteers.module';
import { QualityModule } from '../quality/quality.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { AccountingSeed } from './seed-accounting';
import { AuditSeed } from './seed-audit';
import { BeneficiariesSeed } from './seed-beneficiaries';
import { FinanceSeed } from './seed-finance';
import { HrSeed } from './seed-hr';
import { MembersSeed } from './seed-members';
import { PlatformSeed } from './seed-platform';
import { ProjectsSeed } from './seed-projects';
import { RiskSeed } from './seed-risk';
import { QualitySeed } from './seed-quality';
import { SupportSeed } from './seed-support';
import { VolunteersSeed } from './seed-volunteers';
import { WebsiteSeed } from './seed-website';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { WebsiteModule } from '../website/website.module';
import { CommsModule } from '../comms/comms.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { CommsSeed } from './seed-comms';
import { MeetingsSeed } from './seed-meetings';

/** الجمعية التجريبية: تعتمد على كل الوحدات لتنشئ بيانات مترابطة عبرها */
@Module({
  imports: [CoreModule, BeneficiariesModule, FundraisingModule, ProjectsModule, AccountingModule, HrModule, RiskModule, VolunteersModule, QualityModule, AuditModule, MembersModule, KnowledgeModule, WebsiteModule, CommsModule, MeetingsModule],
  controllers: [DemoController],
  providers: [DemoService, BeneficiariesSeed, ProjectsSeed, FinanceSeed, PlatformSeed, AccountingSeed, SupportSeed, HrSeed, RiskSeed, VolunteersSeed, QualitySeed, AuditSeed, MembersSeed, WebsiteSeed, CommsSeed, MeetingsSeed],
})
export class DemoModule {}
