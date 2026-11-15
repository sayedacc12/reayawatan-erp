import { AidDisbursement } from './aid-disbursement.entity';
import { Beneficiary } from './beneficiary.entity';
import { BeneficiaryDocument } from './beneficiary-document.entity';
import { CaseResearch } from './case-research.entity';
import { FamilyMember } from './family-member.entity';

export { AidDisbursement, Beneficiary, BeneficiaryDocument, CaseResearch, FamilyMember };
export const BENEFICIARY_ENTITIES = [Beneficiary, FamilyMember, CaseResearch, AidDisbursement, BeneficiaryDocument];
