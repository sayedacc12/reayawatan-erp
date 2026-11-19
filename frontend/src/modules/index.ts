import type { RouteRecordRaw } from 'vue-router';
import { beneficiariesRoutes } from './beneficiaries/routes';
import { accountingRoutes } from './accounting/routes';
import { auditRoutes } from './audit/routes';
import { coreRoutes } from './core/routes';
import { fundraisingRoutes } from './fundraising/routes';
import { hrRoutes } from './hr/routes';
import { membersRoutes } from './members/routes';
import { projectsRoutes } from './projects/routes';
import { riskRoutes } from './risk/routes';
import { governanceRoutes } from './governance/routes';
import { qualityRoutes } from './quality/routes';
import { platformRoutes } from './platform/routes';
import { supportRoutes } from './support/routes';
import { volunteersRoutes } from './volunteers/routes';
import { knowledgeRoutes } from './knowledge/routes';
import { websiteRoutes } from './website/routes';
import { partnershipsRoutes } from './partnerships/routes';
import { commsRoutes } from './comms/routes';
import { meetingsRoutes } from './meetings/routes';
import { planningRoutes } from './planning/routes';
import { procurementRoutes } from './procurement/routes';

/**
 * شاشات كل وحدة تُسجَّل هنا. لإضافة وحدة: أنشئ src/modules/<code>/routes.ts
 * وأضفها للمصفوفة. كل route يحمل meta.permission ومساره يطابق menu في manifest الخلفية.
 */
export const moduleRoutes: RouteRecordRaw[] = [...platformRoutes, ...supportRoutes, ...beneficiariesRoutes, ...fundraisingRoutes, ...projectsRoutes, ...accountingRoutes, ...procurementRoutes, ...hrRoutes, ...riskRoutes, ...planningRoutes, ...governanceRoutes, ...volunteersRoutes, ...qualityRoutes, ...auditRoutes, ...membersRoutes, ...knowledgeRoutes, ...partnershipsRoutes, ...websiteRoutes, ...commsRoutes, ...meetingsRoutes, ...coreRoutes];
