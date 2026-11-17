import type { RouteRecordRaw } from 'vue-router';
import { beneficiariesRoutes } from './beneficiaries/routes';
import { accountingRoutes } from './accounting/routes';
import { coreRoutes } from './core/routes';
import { fundraisingRoutes } from './fundraising/routes';
import { hrRoutes } from './hr/routes';
import { projectsRoutes } from './projects/routes';
import { riskRoutes } from './risk/routes';
import { platformRoutes } from './platform/routes';
import { supportRoutes } from './support/routes';
import { volunteersRoutes } from './volunteers/routes';

/**
 * شاشات كل وحدة تُسجَّل هنا. لإضافة وحدة: أنشئ src/modules/<code>/routes.ts
 * وأضفها للمصفوفة. كل route يحمل meta.permission ومساره يطابق menu في manifest الخلفية.
 */
export const moduleRoutes: RouteRecordRaw[] = [...platformRoutes, ...supportRoutes, ...beneficiariesRoutes, ...fundraisingRoutes, ...projectsRoutes, ...accountingRoutes, ...hrRoutes, ...riskRoutes, ...volunteersRoutes, ...coreRoutes];
