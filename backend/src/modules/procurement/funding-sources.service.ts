import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** بيانات مصدر التمويل التي تحتاجها المشتريات */
export interface FundingBatchInfo {
  batchNo: number;
  status: string;
  conditions: Record<string, unknown> | null;
  targetKind: string;
  targetName: string;
  activityId: string | null;
}

const UNAVAILABLE = 'مصادر التمويل المقيدة (التبرعات والمنح) غير متاحة في نظام الشركة';

/**
 * رعاية وطن شركة واحدة بلا وحدة تنمية موارد، فلا توجد دفعات تمويل مقيدة.
 * هذه الخدمة تحل محل خدمة التمويل في سنابل بنفس الواجهة، وترفض أي عملية تحمل مصدر تمويل
 * حتى لا يمر شراء مربوط بمصدر غير موجود. بدون مصدر تمويل يعمل الشراء على بند الميزانية كالمعتاد.
 */
@Injectable()
export class FundingSources {
  async getBatch(_org: string, _id: string, _m?: EntityManager): Promise<FundingBatchInfo> {
    throw new BadRequestException(UNAVAILABLE);
  }
  async reserve(_org: string, _batchId: string, _amount: number, _m?: EntityManager): Promise<void> {
    throw new BadRequestException(UNAVAILABLE);
  }
  async release(_org: string, _batchId: string, _amount: number, _m?: EntityManager): Promise<void> {
    throw new BadRequestException(UNAVAILABLE);
  }
  async spend(_org: string, _batchId: string, _amount: number, _m?: EntityManager): Promise<void> {
    throw new BadRequestException(UNAVAILABLE);
  }
  async unspend(_org: string, _batchId: string, _amount: number, _toReserved: boolean, _m?: EntityManager): Promise<void> {
    throw new BadRequestException(UNAVAILABLE);
  }
}
