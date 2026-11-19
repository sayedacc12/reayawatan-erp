import * as fs from 'fs';
import * as path from 'path';
import { routeInventory } from './route-inventory';

/**
 * بوابة أمنية: كل مسار API يجب أن يحمل قرار صلاحية صريحًا:
 *   @RequirePermissions / @RequireAnyPermission / @Public / @AuthenticatedOnly('السبب')
 *
 * المسارات القديمة التي لا تحمل قرارًا مسجلة في route-authz.baseline.json (تُراجع وتُقلَّص تدريجيًا).
 * والمسارات العامة (@Public) مسجلة كذلك، فأي مسار عام جديد يظهر في الفرق ويحتاج مراجعة بشرية.
 *
 * تحديث القائمة بعد مراجعة بشرية فقط:  UPDATE_ROUTE_BASELINE=1 npx jest test/security/route-authz.spec.ts
 */
const BASELINE = path.join(__dirname, 'route-authz.baseline.json');

describe('Security gate: every route declares an authorization decision', () => {
  const routes = routeInventory();
  const undecided = routes.filter((r) => r.decision === 'none').map((r) => r.key).sort();
  const publicRoutes = routes.filter((r) => r.decision === 'public').map((r) => r.key).sort();

  if (process.env.UPDATE_ROUTE_BASELINE === '1') {
    fs.writeFileSync(BASELINE, JSON.stringify({
      note: 'Reviewed legacy routes. Do not add entries without a security review. Shrink this list over time.',
      undecided, public: publicRoutes,
    }, null, 2) + '\n');
  }
  const baseline: { undecided: string[]; public: string[] } = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  it('discovers the API surface', () => {
    expect(routes.length).toBeGreaterThan(500);
  });

  it('has no duplicate route definitions', () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const r of routes) {
      const prev = seen.get(r.key);
      if (prev) dups.push(`${r.key} (${prev} / ${r.controller}.${r.handler})`);
      seen.set(r.key, `${r.controller}.${r.handler}`);
    }
    expect(dups).toEqual([]);
  });

  it('no NEW route without an explicit authorization decision', () => {
    const allowed = new Set(baseline.undecided);
    const fresh = routes.filter((r) => r.decision === 'none' && !allowed.has(r.key))
      .map((r) => `${r.key}  ->  ${r.file} ${r.controller}.${r.handler}`);
    expect(fresh).toEqual([]);
  });

  it('no NEW public (unauthenticated) route without security review', () => {
    const allowed = new Set(baseline.public);
    const fresh = routes.filter((r) => r.decision === 'public' && !allowed.has(r.key))
      .map((r) => `${r.key}  ->  ${r.file} ${r.controller}.${r.handler}`);
    expect(fresh).toEqual([]);
  });

  it('baseline only shrinks (stale entries must be removed)', () => {
    const now = new Set([...undecided, ...publicRoutes]);
    const stale = [...baseline.undecided, ...baseline.public].filter((k) => !now.has(k));
    expect(stale).toEqual([]);
  });

  it('platform routes always require a platform permission', () => {
    const bad = routes.filter((r) => r.path.startsWith('/platform') && r.decision !== 'permission').map((r) => r.key);
    expect(bad).toEqual([]);
  });
});
