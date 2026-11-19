## What changed

## Security impact
- [ ] Touches auth / permissions / tenant data / money / donations / procurement / inventory / payroll / portals / uploads / migrations
- [ ] Every new route has `@RequirePermissions`, `@RequireAnyPermission`, `@Public` or `@AuthenticatedOnly(reason)`
- [ ] Every new query filters `organizationId`; foreign ids from input are checked within the organization
- [ ] Automatic entries stay owned by their source system; restricted funds checked before budget
- [ ] No secrets, tokens or personal data in code, tests or logs
- [ ] `sayed` security review run (findings addressed or listed below)

## Gates run
- [ ] `npm run typecheck` (backend, frontend)
- [ ] `npx jest test/security/route-authz.spec.ts`
- [ ] `npx jest test/security/tenant-isolation.e2e-spec.ts`
- [ ] Module e2e spec(s):

## Database / deployment
- [ ] No migration  /  migration added (owner applies it on the server)
