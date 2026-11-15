import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { FundraisingModule } from '../fundraising/fundraising.module';
import { HrModule } from '../hr/hr.module';
import { ProjectsModule } from '../projects/projects.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { AccountingSeed } from './seed-accounting';
import { BeneficiariesSeed } from './seed-beneficiaries';
import { FinanceSeed } from './seed-finance';
import { HrSeed } from './seed-hr';
import { PlatformSeed } from './seed-platform';
import { ProjectsSeed } from './seed-projects';
import { SupportSeed } from './seed-support';

/** الجمعية التجريبية: تعتمد على كل الوحدات لتنشئ بيانات مترابطة عبرها */
@Module({
  imports: [CoreModule, BeneficiariesModule, FundraisingModule, ProjectsModule, AccountingModule, HrModule],
  controllers: [DemoController],
  providers: [DemoService, BeneficiariesSeed, ProjectsSeed, FinanceSeed, PlatformSeed, AccountingSeed, SupportSeed, HrSeed],
})
export class DemoModule {}
