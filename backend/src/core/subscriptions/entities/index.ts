import { ContractClause } from './contract-clause.entity';
import { PlatformSetting } from './platform-setting.entity';
import { SubscriptionApplication } from './subscription-application.entity';
import { SubscriptionContract } from './subscription-contract.entity';

export * from './subscription-application.entity';
export * from './subscription-contract.entity';
export { ContractClause, PlatformSetting };
export const SUBSCRIPTION_ENTITIES = [SubscriptionApplication, SubscriptionContract, ContractClause, PlatformSetting];
