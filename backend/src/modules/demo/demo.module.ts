import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { FundraisingModule } from '../fundraising/fundraising.module';
import { ProjectsModule } from '../projects/projects.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { BeneficiariesSeed } from './seed-beneficiaries';
import { FinanceSeed } from './seed-finance';
import { PlatformSeed } from './seed-platform';
import { ProjectsSeed } from './seed-projects';

/** الجمعية التجريبية: تعتمد على كل الوحدات لتنشئ بيانات مترابطة عبرها */
@Module({
  imports: [CoreModule, BeneficiariesModule, FundraisingModule, ProjectsModule],
  controllers: [DemoController],
  providers: [DemoService, BeneficiariesSeed, ProjectsSeed, FinanceSeed, PlatformSeed],
})
export class DemoModule {}
