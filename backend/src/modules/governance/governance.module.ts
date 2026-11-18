import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { GOV_ENTITIES } from './entities/governance.entity';
import { GovFinance } from './gov-finance.service';
import { GovSignals } from './gov-signals.service';
import { GovernanceController } from './governance.controller';
import { GovernanceReports } from './governance.reports';
import { GovernanceService } from './governance.service';

/**
 * الحوكمة: التقييم الذاتي التنبؤي وفق أدلة حوكمة الجمعيات الأهلية الصادرة عن المركز الوطني لتنمية القطاع غير الربحي.
 * يقرأ (دون كتابة) من: النظام المالي (القيود المرحّلة على الدليل الموحد) لحساب مؤشرات الأداء المالي،
 * ومن الموارد البشرية والمراجعة الداخلية والعضوية والجودة والمخاطر والمساعدات الاجتماعية لاقتراح إجابات البطاقات.
 */
@Module({
  imports: [TypeOrmModule.forFeature(GOV_ENTITIES), CoreModule],
  controllers: [GovernanceController],
  providers: [GovFinance, GovSignals, GovernanceService, GovernanceReports],
  exports: [GovFinance, GovSignals, GovernanceService],
})
export class GovernanceModule {}
