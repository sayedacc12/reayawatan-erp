export type CaseStatus = 'new' | 'under_review' | 'eligible' | 'ineligible' | 'suspended';
export type Gender = 'male' | 'female';

export interface BeneficiaryRow {
  id: string;
  fileNo: number;
  fullName: string;
  nationalId: string | null;
  phone: string | null;
  city: string | null;
  category: string;
  status: CaseStatus;
  gender: Gender;
  monthlyIncome: number;
  familySize: number;
  aidTotal: number;
  lastAidOn: string | null;
}

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }

export interface FamilyMember {
  id: string;
  fullName: string;
  relation: string;
  gender: Gender;
  birthDate: string | null;
  nationalId: string | null;
  occupation: string | null;
  monthlyIncome: number;
  healthStatus: string | null;
}

export interface Research {
  id: string;
  visitDate: string;
  researcherName: string;
  findings: string;
  decision: 'eligible' | 'ineligible' | 'needs_followup';
  recommendedAid: string | null;
  nextReviewDate: string | null;
}

export interface Aid {
  id: string;
  aidType: string;
  amount: number;
  description: string | null;
  disbursedOn: string;
  referenceNo: string | null;
}

export interface DocumentRow {
  id: string;
  title: string;
  docType: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface BeneficiaryFields {
  fullName: string;
  nationalId: string | null;
  gender: Gender;
  birthDate: string | null;
  phone: string | null;
  altPhone: string | null;
  city: string | null;
  address: string | null;
  maritalStatus: string | null;
  category: string;
  status: CaseStatus;
  monthlyIncome: number;
  incomeSource: string | null;
  housingType: string | null;
  monthlyRent: number | null;
  healthStatus: string | null;
  notes: string | null;
}

export interface Beneficiary extends BeneficiaryFields {
  id: string;
  hasPortalAccess: boolean;
  fileNo: number;
  createdAt: string;
  family: FamilyMember[];
  researches: Research[];
  aids: Aid[];
  documents: DocumentRow[];
  summary: {
    familySize: number;
    householdIncome: number;
    perCapitaIncome: number;
    aidTotal: number;
    aidCount: number;
    lastAidOn: string | null;
  };
}

export interface Stats {
  beneficiaries: number;
  familyMembers: number;
  aidThisMonth: number;
  aidThisYear: number;
  byStatus: Partial<Record<CaseStatus, number>>;
  byCategory: { category: string; count: number }[];
  aidByType: { aidType: string; count: number; amount: number }[];
  monthly: { month: string; amount: number; count: number }[];
  recentAids: { id: string; aidType: string; amount: number; disbursedOn: string; beneficiaryId: string; fullName: string; fileNo: number }[];
  upcomingReviews: { id: string; fullName: string; fileNo: number; nextReviewDate: string }[];
}

// ---------- الطلبات وسير العمل ----------
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'support';
export interface SupportAnswer { decision: 'full' | 'partial' | 'none'; percent?: number }
export interface FormField {
  key: string; label: string; type: FieldType; required?: boolean; options?: string[]; placeholder?: string;
  /** الأهمية النسبية للبند في نموذج التقييم (من 100) */
  weight?: number;
  /** درجة كل اختيار في القائمة (من 100) */
  optionScores?: number[];
}
export type ScoreOutcome = 'reject' | 'approve' | 'contribution';
export interface ScoreRule { min: number; max: number; outcome: ScoreOutcome; contributionPercent?: number }
export type FormStatus = 'draft' | 'approved';
export interface FormPlacement { workflowId: string; workflowName: string; stageId: string | null; stageName: string }
export interface DynamicForm {
  id: string; name: string; description: string | null; fields: FormField[]; scored?: boolean; rules?: ScoreRule[];
  status?: FormStatus; createdByName?: string | null; approvedByName?: string | null; approvedAt?: string | null; placements?: FormPlacement[];
}

export type Recurrence = 'once' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
export interface ProjectService { name: string; cost?: number | null }

export interface ActivityRow {
  id: string; level: 'axis' | 'program' | 'project'; parentId: string | null; name: string; description: string | null;
  workflowId: string | null; workflowName: string | null; portalVisible: boolean; isActive: boolean; sortOrder: number; requestCount: number;
  services: ProjectService[]; multiServices: boolean; allowConcurrent: boolean; recurrence: Recurrence;
}

export interface StageRow {
  id?: string; name: string; instructions: string | null; formId: string | null; formName?: string | null;
  roleId: string | null; roleName?: string | null; canReject: boolean; canReturn: boolean; activeRequests?: number;
  kind: 'standard' | 'contribution'; formScored?: boolean; formStatus?: FormStatus | null;
}
export interface WorkflowRow {
  id: string; name: string; description: string | null; isDefault: boolean; applicationFormId: string | null;
  applicationFormName: string | null; applicationFormStatus?: FormStatus | null; applicationFormFields?: FormField[] | null; stages: StageRow[];
}

export type RequestStatus = 'in_progress' | 'returned' | 'approved' | 'rejected' | 'cancelled';
export interface RequestRow {
  id: string; requestNo: number; closedAt?: string | null; status: RequestStatus; source: 'portal' | 'staff'; createdAt: string; updatedAt: string;
  beneficiary: { id: string; fullName: string; fileNo: number }; project: { id: string; name: string };
  stage: { id: string; name: string } | null;
  ruleDeviation?: boolean;
}
export interface RequestAction {
  id: string; stageId: string | null; stageName: string | null; decision: 'submitted' | 'approve' | 'reject' | 'return' | 'resubmitted' | 'cancelled' | 'skipped' | 'contribution_sent';
  notes: string | null; formName: string | null; formData: Record<string, unknown> | null; formFields: FormField[] | null;
  actorName: string; createdAt: string; score?: number | null;
}
export type ContributionStatus = 'none' | 'awaiting' | 'submitted' | 'verified';
export interface JournalEntry {
  date: string; amount: number; description: string;
  debit: { code: string | null; name: string | null }; credit: { code: string | null; name: string | null };
}
export interface Contribution {
  status: ContributionStatus; percent: number | null; amount: number | null; requiredAmount: number | null;
  documentId: string | null; submittedAt: string | null; verifiedAt: string | null; journal?: JournalEntry | null;
}
export interface RequestDetail {
  id: string; requestNo: number; status: RequestStatus; source: 'portal' | 'staff'; description: string | null;
  applicationData: Record<string, unknown>; createdAt: string; closedAt: string | null; currentStageId: string | null;
  canDecide?: boolean;
  services: string[]; estimatedCost: number | null;
  research?: {
    score: number | null; outcome: ScoreOutcome | null; contributionPercent: number | null;
    supportPercent: number | null; supportAmount: number | null;
    suggestion: { score: number; outcome: ScoreOutcome; contributionPercent: number } | null;
    deviation: boolean; deviationReason: string | null;
  } | null;
  contribution: Contribution;
  beneficiary?: { id: string; fileNo: number; fullName: string; nationalId: string | null; phone: string | null; category: string; status: CaseStatus };
  project: { id: string; name: string; path: string[] };
  workflow: {
    id: string; name: string;
    applicationForm: { id: string; name: string; fields: FormField[] } | null;
    stages: { id: string; name: string; sortOrder: number; instructions?: string | null; canReject?: boolean; canReturn?: boolean; roleName?: string | null; kind?: 'standard' | 'contribution'; form?: { id: string; name: string; fields: FormField[]; scored?: boolean; rules?: ScoreRule[]; status?: FormStatus } | null }[];
  } | null;
  actions: RequestAction[];
}
export interface TicketRow {
  id: string; ticketNo: number; type: 'complaint' | 'suggestion' | 'inquiry'; subject: string; message: string;
  status: 'open' | 'answered' | 'closed'; reply: string | null; repliedByName: string | null; repliedAt: string | null; createdAt: string;
  beneficiary?: { id: string; fullName: string; fileNo: number; phone: string | null };
}
