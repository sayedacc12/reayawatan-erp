export interface DonorField {
  key: string; label: string; type: string; required: boolean; options?: string[]; min?: number | null; max?: number | null; isActive: boolean;
}
export interface AccountRef { code: string | null; name: string | null }
export interface JournalRouting {
  cash: { description: string | null };
  inKind: { debit: AccountRef; description: string | null };
  pledge: { debit: AccountRef; description: string | null };
  pledgeCollection: { description: string | null };
  credit: { operational: AccountRef; restricted: AccountRef; zakat: AccountRef; waqf: AccountRef; case: AccountRef };
}
export interface Level { id: string; name: string; color: string; minAmount: number | null; sortOrder: number }
export interface Manager { id: string; name: string; kind: 'employee' | 'external'; userId: string | null; userName: string | null; entityName: string | null; phone: string | null; email: string | null; isActive: boolean }
export interface Bank { id: string; bankName: string; accountName: string | null; accountNumber: string; iban: string | null; glCode: string | null; glName: string | null; isActive: boolean }
export interface Waqf { id: string; name: string; description: string | null; targetAmount: number | null; isActive: boolean }
export interface Stage { id?: string; name: string; instructions: string | null; roleId: string | null; roleName?: string | null; canReject: boolean; canReturn: boolean; sortOrder?: number }
export interface Settings {
  donorFields: DonorField[]; journalRouting: JournalRouting; levels: Level[]; managers: Manager[]; banks: Bank[]; waqf: Waqf[]; stages: Stage[];
}

export interface DonorRow {
  id: string; donorNo: number; name: string; type: string; phone: string | null; email: string | null; city: string | null; isActive: boolean;
  levelId: string | null; levelName: string | null; levelColor: string | null; managerName: string | null;
  totalDonated: number; opportunityCount: number; lastDonation: string | null;
}
export interface Donor {
  id: string; donorNo: number; name: string; type: 'individual' | 'entity'; identifier: string | null; phone: string | null; email: string | null;
  city: string | null; levelId: string | null; supportManagerId: string | null; customData: Record<string, unknown>; notes: string | null; isActive: boolean;
  createdAt: string;
}

export interface Conditions { acceptsPatientContribution: boolean; maxSpend: number | null; nationalities: string[]; categories: string[]; endDate: string | null }

export interface Batch {
  id: string; batchNo: number; opportunityId: string; lineNo: number; donorId: string; targetKind: string; activityId: string | null;
  waqfProjectId: string | null; beneficiaryRequestId: string | null; targetName: string; allocationMode: 'amount' | 'percent'; percent: number | null;
  amount: number; isZakat: boolean; isPromised: boolean; conditions: Conditions; status: string; reservedAmount: number; spentAmount: number;
  transferredAmount: number; net: number; parentBatchId: string | null; donorName?: string; opportunityNo?: number;
}

export interface LedgerLine { id: string; lineNo: number; accountCode: string | null; accountName: string; debit: number; credit: number; memo: string | null }
export interface LedgerEntry {
  id: string; entryNo: number; date: string; description: string; sourceModule: string; sourceType: string; sourceId: string | null;
  total: number; status: 'posted' | 'reversed'; reversalOfId: string | null; reversedById: string | null; opportunityId: string | null;
  createdByName: string | null; lines: LedgerLine[]; createdAt: string;
}

export interface Opportunity {
  id: string; opportunityNo: number; kind: 'cash' | 'in_kind' | 'pledge'; status: string; currentStageId: string | null; stageName: string | null;
  donorId: string; supportManagerId: string | null; supportManagerName: string | null; date: string; totalAmount: number; bankAccountId: string | null;
  transferReference: string | null; isZakat: boolean; conditions: Conditions; conditionsText: string | null; inKindDescription: string | null;
  receiptNo: number | null; journalEntryId: string | null; collectedAmount: number; createdByName: string | null; approvedAt: string | null; createdAt: string;
  donor: { id: string; donorNo: number; name: string; phone: string | null; email: string | null; identifier: string | null; levelName: string | null; levelColor: string | null } | null;
  bankAccount: { id: string; bankName: string; accountNumber: string; iban: string | null } | null;
  batches: Batch[];
  actions: { id: string; action: string; stageName: string | null; notes: string | null; actorName: string; createdAt: string }[];
  documents: { id: string; title: string; fileName: string; mimeType: string; sizeBytes: number; uploadedByName: string | null; createdAt: string }[];
  collections: { id: string; collectedOn: string; amount: number; bankName: string | null; transferReference: string | null; receiptNo: number; createdByName: string | null }[];
  stages: Stage[];
  entries: LedgerEntry[];
  canDecide: boolean;
}

export interface OpportunityRow {
  id: string; opportunityNo: number; kind: string; status: string; date: string; totalAmount: number; collectedAmount: number; isZakat: boolean;
  receiptNo: number | null; donorId: string; donorName: string; stageName: string | null; batchCount: number; targetKinds: string | null;
}

export interface Targets {
  programs: { id: string; level: string; name: string; path: string; zakatEligible: boolean }[];
  operational: { id: string; level: string; name: string; path: string }[];
  waqf: { id: string; name: string; description: string | null; targetAmount: number | null }[];
  cases: { id: string; requestNo: number; status: string; services: string[]; estimatedCost: number | null; beneficiaryName: string; fileNo: number; projectId: string; projectName: string; zakatEligible: boolean; funded: number }[];
}
