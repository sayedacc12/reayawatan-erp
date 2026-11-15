import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BeneficiariesController } from './beneficiaries.controller';
import { BeneficiariesService } from './beneficiaries.service';
import { DocumentStorage } from './document-storage.service';
import { BENEFICIARY_ENTITIES } from './entities';

/** وحدة المستفيدين: الملفات والأسر والبحث الاجتماعي والمساعدات والمستندات */
@Module({
  imports: [TypeOrmModule.forFeature(BENEFICIARY_ENTITIES)],
  controllers: [BeneficiariesController],
  providers: [BeneficiariesService, DocumentStorage],
  // للوحدات القادمة (مثل المالية) لربط الصرف بالقيود
  exports: [BeneficiariesService],
})
export class BeneficiariesModule {}
