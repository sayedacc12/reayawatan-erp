import { INSTALLED_MODULES } from '../../platform/module-registry';
import { DEFAULT_ROLES } from './default-roles';
import { COMPANY_TEAM } from '../company-team';

/** الأدوار الافتراضية لرعاية وطن تغطي معًا كل صلاحية في وحدات الشركة، ولا تذكر صلاحية غير موجودة */
describe('Default company roles', () => {
  const orgCodes = INSTALLED_MODULES.filter((m) => (m.scope ?? 'organization') === 'organization').flatMap((m) => m.permissions.map((p) => p.code));

  it('cover every organization permission', () => {
    const granted = new Set(DEFAULT_ROLES.flatMap((r) => r.permissions));
    expect(orgCodes.filter((c) => !granted.has(c))).toEqual([]);
  });

  it('use only existing permissions and unique, valid names', () => {
    const known = new Set(orgCodes);
    for (const r of DEFAULT_ROLES) {
      expect(r.permissions.filter((c) => !known.has(c))).toEqual([]);
      expect(r.name.length).toBeLessThanOrEqual(100);
    }
    expect(new Set(DEFAULT_ROLES.map((r) => r.name)).size).toBe(DEFAULT_ROLES.length);
  });

  it('give the company team only roles that exist, and cover every default role except the basic one', () => {
    const names = new Set(DEFAULT_ROLES.map((r) => r.name));
    const used = new Set(COMPANY_TEAM.flatMap((m) => m.roles));
    expect([...used].filter((n) => !names.has(n))).toEqual([]);
    expect([...names].filter((n) => !used.has(n) && n !== 'موظف')).toEqual([]);
  });
});
