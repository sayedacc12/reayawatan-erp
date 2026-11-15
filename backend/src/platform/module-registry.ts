import { ErpModuleManifest } from './erp-module';
import { coreManifest, platformManifest } from '../core/core.manifest';
import { supportManifest } from '../core/support/support.manifest';
import { beneficiariesManifest } from '../modules/beneficiaries/beneficiaries.manifest';
import { fundraisingManifest } from '../modules/fundraising/fundraising.manifest';
import { projectsManifest } from '../modules/projects/projects.manifest';
import { accountingManifest } from '../modules/accounting/accounting.manifest';

/**
 * سجل الوحدات المثبتة.
 * لإضافة وحدة جديدة: أنشئ مجلدها تحت src/modules ثم أضف الـ manifest هنا
 * وأضف الـ Nest module الخاص بها في app.module.ts.
 */
export const INSTALLED_MODULES: ErpModuleManifest[] = [platformManifest, supportManifest, coreManifest, beneficiariesManifest, fundraisingManifest, projectsManifest, accountingManifest];

export function validateManifests(manifests: ErpModuleManifest[]): void {
  const codes = new Set<string>();
  const permCodes = new Set<string>();
  for (const m of manifests) {
    if (!/^[a-z][a-z0-9_]*$/.test(m.code)) {
      throw new Error(`Invalid module code "${m.code}"`);
    }
    if (codes.has(m.code)) throw new Error(`Duplicate module code "${m.code}"`);
    codes.add(m.code);
    for (const p of m.permissions) {
      if (!p.code.startsWith(`${m.code}.`)) {
        throw new Error(`Permission "${p.code}" must start with "${m.code}."`);
      }
      if (permCodes.has(p.code)) throw new Error(`Duplicate permission "${p.code}"`);
      permCodes.add(p.code);
    }
    for (const item of m.menu) {
      if (!m.permissions.some((p) => p.code === item.permission)) {
        throw new Error(`Menu "${item.path}" uses unknown permission "${item.permission}"`);
      }
    }
  }
  for (const m of manifests) {
    for (const dep of m.depends ?? []) {
      if (!codes.has(dep)) throw new Error(`Module "${m.code}" depends on missing "${dep}"`);
    }
  }
}
