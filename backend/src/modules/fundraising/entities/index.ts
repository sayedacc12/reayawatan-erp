import { Batch } from './batch.entity';
import { Donor } from './donor.entity';
import { LedgerEntry, LedgerLine } from './ledger.entity';
import { Opportunity, OpportunityAction, OpportunityDocument, PledgeCollection } from './opportunity.entity';
import { ApprovalStage, BankAccount, DonorLevel, FundraisingSettings, SupportManager, WaqfProject } from './settings.entity';

export {
  ApprovalStage, BankAccount, Batch, Donor, DonorLevel, FundraisingSettings, LedgerEntry, LedgerLine, Opportunity, OpportunityAction,
  OpportunityDocument, PledgeCollection, SupportManager, WaqfProject,
};
export type { BatchStatus, BatchTarget } from './batch.entity';
export type { DonorConditions, OpportunityActionType, OpportunityKind, OpportunityStatus, ResidencyCategory } from './opportunity.entity';
export type { AccountRef, DonorField, DonorFieldType, JournalRouting } from './settings.entity';
export { DEFAULT_ROUTING } from './settings.entity';
export { RESIDENCY_CATEGORIES } from './opportunity.entity';

export const FUNDRAISING_ENTITIES = [
  FundraisingSettings, DonorLevel, SupportManager, BankAccount, WaqfProject, ApprovalStage, Donor,
  Opportunity, Batch, OpportunityAction, OpportunityDocument, PledgeCollection, LedgerEntry, LedgerLine,
];
