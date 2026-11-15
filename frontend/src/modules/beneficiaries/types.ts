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
