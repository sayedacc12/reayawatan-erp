import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../../core/core.module';
import { KNOWLEDGE_ENTITIES } from './entities/knowledge.entity';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeReports } from './knowledge.reports';
import { KnowledgeService } from './knowledge.service';

/** أرشيف المعرفة: الوثائق وإصداراتها وتصنيفاتها ونشر المختار منها في الموقع الإلكتروني */
@Module({
  imports: [TypeOrmModule.forFeature(KNOWLEDGE_ENTITIES), CoreModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeReports],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
