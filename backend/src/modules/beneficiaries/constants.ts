/** قيم ثابتة للوحدة، والواجهة تعرض لها أسماء عربية */
export const GENDERS = ['male', 'female'] as const;
export const MARITAL_STATUSES = ['single', 'married', 'widowed', 'divorced'] as const;
export const HOUSING_TYPES = ['owned', 'rented', 'shared', 'other'] as const;
/** دورة حياة الحالة: جديدة ← تحت الدراسة ← مستحقة/غير مستحقة، ويمكن إيقافها */
export const CASE_STATUSES = ['new', 'under_review', 'eligible', 'ineligible', 'suspended'] as const;
export const CATEGORIES = [
  'orphan', 'widow', 'elderly', 'disability', 'poor_family', 'patient', 'student', 'debtor', 'other',
] as const;
export const RESEARCH_DECISIONS = ['eligible', 'ineligible', 'needs_followup'] as const;
export const AID_TYPES = ['cash', 'in_kind', 'medical', 'education', 'housing', 'seasonal', 'other'] as const;
export const DOCUMENT_TYPES = ['national_id', 'death_certificate', 'medical_report', 'income_proof', 'lease', 'photo', 'contribution_proof', 'other'] as const;

export type Gender = (typeof GENDERS)[number];
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export type HousingType = (typeof HOUSING_TYPES)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type Category = (typeof CATEGORIES)[number];
export type ResearchDecision = (typeof RESEARCH_DECISIONS)[number];
export type AidType = (typeof AID_TYPES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** أثر قرار البحث على حالة الملف */
export const DECISION_TO_STATUS: Record<ResearchDecision, CaseStatus> = {
  eligible: 'eligible',
  ineligible: 'ineligible',
  needs_followup: 'under_review',
};

/** أنواع الملفات المسموح رفعها كمستندات */
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
