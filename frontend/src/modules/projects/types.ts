export type FundingType = 'restricted' | 'unrestricted' | 'operational';
export type ApprovalStatus = 'draft' | 'pending' | 'returned' | 'approved' | 'rejected';
export type SpendingMode = 'beneficiaries' | 'general';

export interface ServiceItem { name: string; cost?: number | null; description?: string | null; portalVisible?: boolean }

export interface TreeNode {
  id: string;
  level: 'axis' | 'program' | 'project';
  parentId: string | null;
  name: string;
  description: string | null;
  isActive: boolean;
  portalVisible: boolean;
  services: ServiceItem[];
  multiServices: boolean;
  requestCount: number;
  projectNo?: number;
  code?: string;
  fundingType?: FundingType;
  zakatEligible?: boolean;
  approvalStatus?: ApprovalStatus;
  currentStage?: { id: string; name: string } | null;
  spendingMode?: SpendingMode;
  managerName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  budget?: number | null;
  targetBeneficiaries?: number | null;
  goals?: string | null;
}

export interface Stage { id?: string; name: string; instructions?: string | null; roleId?: string | null; roleName?: string | null; pendingCount?: number }

export interface ProjectRow {
  id: string; code: string; name: string; isActive: boolean;
  axisId: string | null; axisName: string; programId: string | null; programName: string;
  fundingType: FundingType; zakatEligible: boolean; approvalStatus: ApprovalStatus; spendingMode: SpendingMode;
  currentStage: { id: string; name: string } | null; managerName: string | null; startDate: string | null; endDate: string | null;
  budget: number | null; targetBeneficiaries: number | null; services: number;
  requests: { total: number; approved: number; open: number }; served: number;
  funds: number; available: number; reserved: number; spent: number; batchCount: number;
  donors: { id: string; name: string; amount: number }[];
}

export interface Conditions {
  acceptsPatientContribution?: boolean;
  maxSpend?: number | null;
  nationalities?: string[];
  categories?: ('citizen' | 'resident' | 'visitor')[];
  endDate?: string | null;
}

export interface Batch {
  id: string; batchNo: number; opportunityId: string; opportunityNo: number | null; donorId: string; donorName: string | null;
  targetKind: string; targetName?: string; activityId: string | null; beneficiaryRequestId: string | null;
  amount: number; reservedAmount: number; spentAmount: number; transferredAmount: number; net: number;
  isZakat: boolean; conditions: Conditions; status: string; parentBatchId: string | null;
  violations?: string[]; level?: 'project' | 'program';
}

export interface Allocation {
  id: string; allocationNo: number; kind: 'request' | 'general'; activityId: string; projectName: string; batchId: string; batchNo: number | null;
  requestId: string | null; requestNo: number | null; beneficiaryId: string | null; beneficiaryName: string | null;
  amount: number; spentAmount: number; releasedAmount: number; remaining: number; pendingPayments: number;
  status: 'reserved' | 'partial' | 'spent' | 'released'; notes: string | null; createdByName: string; createdAt: string;
  donorId: string | null; donorName: string | null; opportunityId: string | null; opportunityNo: number | null;
}

export interface Payment {
  id: string; requestNo: number; activityId: string; projectName: string; allocationId: string; allocationNo: number; allocationKind: string;
  beneficiaryRequestId: string | null; beneficiaryRequestNo: number | null; beneficiaryId: string | null;
  batchId: string; batchNo: number | null; donorName: string | null; opportunityId: string | null;
  amount: number; method: 'voucher' | 'invoice'; payeeKind: string; payeeName: string; description: string | null;
  status: 'pending' | 'paid' | 'rejected'; requestedByName: string; referenceNo: string | null; paidOn: string | null;
  executedByName: string | null; executedAt: string | null; rejectReason: string | null; journalEntryId: string | null; createdAt: string;
}

export interface QueueItem {
  id: string; requestNo: number; projectId: string; projectName: string; estimatedCost: number | null; supportPercent: number | null;
  contributionPercent: number | null; beneficiaryId: string; beneficiaryName: string; fileNo: number; nationality: string | null; residency: string | null;
  need: number | null; covered: number; outstanding: number | null; approvedAt: string | null;
}

export interface Transfer {
  id: string; transferNo: number; sourceBatchId: string; targetBatchId: string; sourceActivityId: string | null; sourceName: string | null;
  targetActivityId: string; targetName: string; donorId: string | null; donorName: string | null; amount: number; reason: string;
  createdByName: string; createdAt: string; sourceBatchNo: number | null; targetBatchNo: number | null;
}

export interface Amendment {
  id: string; amendmentNo: number; opportunityId: string; opportunityNo: number | null; batchId: string; batchNo: number | null;
  newBatchId: string | null; newBatchNo: number | null; effectiveDate: string; amount: number; reason: string;
  before: { activityId: string | null; activityName: string | null; conditions: Conditions };
  after: { activityId: string | null; activityName: string | null; conditions: Conditions };
  donorApproved: boolean; donorApprovalRef: string | null; acknowledgedByName: string; reversalEntryId: string | null; reissueEntryId: string | null;
  donorName: string | null; createdAt: string;
}

export interface LedgerEntry {
  id: string; entryNo: number; date: string; description: string; sourceModule: string; sourceType: string; total: number; status: string;
  lines: { id: string; accountCode: string | null; accountName: string; debit: number; credit: number; activityId: string | null }[];
}
