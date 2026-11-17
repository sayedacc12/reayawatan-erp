import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { ChangeService } from './change.service';
import { ComplianceService } from './compliance.service';
import { ContinuityService } from './continuity.service';
import { RISK_ENTITIES } from './entities/risk.entity';
import { RegisterService } from './register.service';
import { RiskAuditBridge, RiskReportsService } from './reports.service';
import { RiskCore } from './risk-core.service';
import { RiskController } from './risk.controller';

/**
 * المخاطر والتغيير والالتزام. سجل المخاطر هنا هو المرجع المؤسسي الموحد:
 * - نظام المراجعة الداخلية يقرأ منه عبر التوكن 'RISK_REGISTER_LOOKUP' (RiskAuditBridge) دون الكتابة فيه.
 * - نظام الجودة يربط مخاطره وفرصه به بدل سجل منفصل.
 * يقرأ الهيكل التنظيمي (hr_units) والمستخدمين للاختيار فقط.
 */
@Module({
  imports: [TypeOrmModule.forFeature(RISK_ENTITIES), CoreModule],
  controllers: [RiskController],
  providers: [
    RiskCore, RegisterService, ChangeService, ComplianceService, ContinuityService, RiskReportsService, RiskAuditBridge,
    { provide: 'RISK_REGISTER_LOOKUP', useExisting: RiskAuditBridge },
  ],
  exports: [RiskCore, RegisterService, ChangeService, ComplianceService, ContinuityService, RiskReportsService, RiskAuditBridge, 'RISK_REGISTER_LOOKUP'],
})
export class RiskModule {}
