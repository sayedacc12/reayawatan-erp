import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsService } from './documents.service';
import { QUALITY_ENTITIES } from './entities/quality.entity';
import { FeedbackService } from './feedback.service';
import { ImprovementService } from './improvement.service';
import { PublicSurveyController, QualityController } from './quality.controller';
import { QmsCore } from './quality-core.service';
import { ReportsService } from './reports.service';
import { ReviewsService } from './reviews.service';
import { QualityReports } from './quality.reports';

/**
 * إدارة الجودة ISO 9001: المرجع المركزي للتوثيق والترميز في كل الأنظمة.
 * تقرأ (دون كتابة) الوثائق المرمّزة في المستفيدين والموارد البشرية لتظهر في السجل الرئيسي،
 * وشكاوى بوابة المستفيدين لتسجيلها في سجل الشكاوى.
 */
@Module({
  imports: [TypeOrmModule.forFeature(QUALITY_ENTITIES)],
  controllers: [QualityController, PublicSurveyController],
  providers: [QualityReports, QmsCore, DocumentsService, ImprovementService, FeedbackService, ReportsService, ReviewsService],
  exports: [QmsCore, DocumentsService, ImprovementService, FeedbackService, ReportsService, ReviewsService],
})
export class QualityModule {}
