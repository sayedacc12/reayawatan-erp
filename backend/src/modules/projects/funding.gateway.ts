import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FundraisingService } from '../fundraising/fundraising.service';
import { LedgerService } from '../fundraising/ledger.service';

/** اشتراطات الداعم على الدفعة (من فرصة التبرع) */
export interface BatchConditions {
  acceptsPatientContribution?: boolean;
  maxSpend?: number | null;
  nationalities?: string[];
  categories?: ('citizen' | 'resident' | 'visitor')[];
  endDate?: string | null;
}

export interface FundingBatch {
  id: string;
  batchNo: number;
  opportunityId: string;
  opportunityNo: number | null;
  donorId: string;
  donorName: string | null;
  targetKind: 'operational' | 'program' | 'waqf' | 'case';
  activityId: string | null;
  beneficiaryRequestId: string | null;
  amount: number;
  reservedAmount: number;
  spentAmount: number;
  transferredAmount: number;
  isZakat: boolean;
  conditions: BatchConditions;
  status: string;
  parentBatchId: string | null;
  createdAt?: string | Date;
}

export interface LedgerLine { accountCode: string; accountName: string; debit: number; credit: number; batchId?: string | null; activityId?: string | null }
export interface LedgerEntryInput {
  date: string;
  description: string;
  source: { module: string; type: string; id: string };
  activityId?: string | null;
  batchId?: string | null;
  opportunityId?: string | null;
  lines: LedgerLine[];
}

export const net = (b: Pick<FundingBatch, 'amount' | 'reservedAmount' | 'spentAmount' | 'transferredAmount'>) =>
  Math.round((b.amount - b.reservedAmount - b.spentAmount - b.transferredAmount) * 100) / 100;

/**
 * نقطة الاتصال الوحيدة بين إدارة المشاريع ونظام الموارد المالية (الدفعات والقيود).
 * كل التعديل على أرصدة الدفعات يتم عبر خدمات الموارد المالية المصدّرة، وليس بالكتابة في جداولها.
 */
@Injectable()
export class FundingGateway {
  constructor(private readonly fundraising: FundraisingService, private readonly ledger: LedgerService) {}

  listBatches(org: string, filter: { activityId?: string; activityIds?: string[]; donorId?: string; opportunityId?: string; status?: string } = {}): Promise<FundingBatch[]> {
    return this.fundraising.listBatches(org, filter as Parameters<FundraisingService['listBatches']>[1]) as unknown as Promise<FundingBatch[]>;
  }

  getBatch(org: string, id: string, m?: EntityManager): Promise<FundingBatch> {
    return this.fundraising.getBatch(org, id, m) as unknown as Promise<FundingBatch>;
  }

  reserve(org: string, batchId: string, amount: number, m?: EntityManager) {
    return this.fundraising.reserve(org, batchId, amount, m);
  }

  release(org: string, batchId: string, amount: number, m?: EntityManager) {
    return this.fundraising.release(org, batchId, amount, m);
  }

  spend(org: string, batchId: string, amount: number, m?: EntityManager) {
    return this.fundraising.spend(org, batchId, amount, m);
  }

  transfer(org: string, sourceBatchId: string, targetActivityId: string, amount: number, m?: EntityManager, conditions?: BatchConditions): Promise<FundingBatch> {
    return this.fundraising.transfer(org, sourceBatchId, targetActivityId, amount, m, conditions) as unknown as Promise<FundingBatch>;
  }

  getOpportunity(org: string, id: string, m?: EntityManager) {
    return this.fundraising.getOpportunity(org, id, m);
  }

  postEntry(org: string, entry: LedgerEntryInput, m?: EntityManager): Promise<{ id: string; entryNo: number }> {
    return this.ledger.postEntry(org, entry, m);
  }

  reverseEntry(org: string, entryId: string, reason: string, m?: EntityManager): Promise<{ id: string }> {
    return this.ledger.reverseEntry(org, entryId, reason, m) as Promise<{ id: string }>;
  }

  listEntries(org: string, filter: { activityId?: string; batchId?: string; opportunityId?: string }) {
    return this.ledger.listEntries(org, filter);
  }
}
