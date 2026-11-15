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
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
export interface FormField { key: string; label: string; type: FieldType; required?: boolean; options?: string[]; placeholder?: string }
export interface DynamicForm { id: string; name: string; description: string | null; fields: FormField[] }

export interface ActivityRow {
  id: string; level: 'axis' | 'program' | 'project'; parentId: string | null; name: string; description: string | null;
  workflowId: string | null; workflowName: string | null; portalVisible: boolean; isActive: boolean; sortOrder: number; requestCount: number;
}

export interface StageRow {
  id?: string; name: string; instructions: string | null; formId: string | null; formName?: string | null;
  roleId: string | null; roleName?: string | null; canReject: boolean; canReturn: boolean; activeRequests?: number;
}
export interface WorkflowRow {
  id: string; name: string; description: string | null; isDefault: boolean; applicationFormId: string | null;
  applicationFormName: string | null; applicationFormFields?: FormField[] | null; stages: StageRow[];
}

export type RequestStatus = 'in_progress' | 'returned' | 'approved' | 'rejected' | 'cancelled';
export interface RequestRow {
  id: string; requestNo: number; closedAt?: string | null; status: RequestStatus; source: 'portal' | 'staff'; createdAt: string; updatedAt: string;
  beneficiary: { id: string; fullName: string; fileNo: number }; project: { id: string; name: string };
  stage: { id: string; name: string } | null;
}
export interface RequestAction {
  id: string; stageId: string | null; stageName: string | null; decision: 'submitted' | 'approve' | 'reject' | 'return' | 'resubmitted' | 'cancelled';
  notes: string | null; formName: string | null; formData: Record<string, unknown> | null; formFields: FormField[] | null;
  actorName: string; createdAt: string;
}
export interface RequestDetail {
  id: string; requestNo: number; status: RequestStatus; source: 'portal' | 'staff'; description: string | null;
  applicationData: Record<string, unknown>; createdAt: string; closedAt: string | null; currentStageId: string | null;
  canDecide?: boolean;
  beneficiary?: { id: string; fileNo: number; fullName: string; nationalId: string | null; phone: string | null; category: string; status: CaseStatus };
  project: { id: string; name: string; path: string[] };
  workflow: {
    id: string; name: string;
    applicationForm: { id: string; name: string; fields: FormField[] } | null;
    stages: { id: string; name: string; sortOrder: number; instructions?: string | null; canReject?: boolean; canReturn?: boolean; roleName?: string | null; form?: { id: string; name: string; fields: FormField[] } | null }[];
  } | null;
  actions: RequestAction[];
}
export interface TicketRow {
  id: string; ticketNo: number; type: 'complaint' | 'suggestion' | 'inquiry'; subject: string; message: string;
  status: 'open' | 'answered' | 'closed'; reply: string | null; repliedByName: string | null; repliedAt: string | null; createdAt: string;
  beneficiary?: { id: string; fullName: string; fileNo: number; phone: string | null };
}
