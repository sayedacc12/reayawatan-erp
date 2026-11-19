# CLAUDE.md — Sanabel ERP (charity-erp)

Multi-tenant SaaS ERP for Saudi charities: financial accounting, restricted donations, procurement,
inventory, HR/payroll, budgeting, supplier and beneficiary portals. Treat every change as touching
money, personal data, or another organization's data, because it usually does.

Stack: NestJS 10 + TypeORM 0.3 + PostgreSQL 16 (backend/), Vue 3 + Vite RTL (frontend/),
Docker Compose + Caddy (deploy/). One database, one `organization_id` per tenant row.

These rules are **mandatory**. A change that breaks one is not done, whatever else it achieves.
Security reference: `docs/security/` (threat model, ASVS matrix, incident response).

---

## 1. Hard stops (never do these; ask the human)

- Never read, print, copy or edit secrets: `.env*`, `/etc/sanabel-backup/**`, `*.pem`, `*.key`,
  SMTP/app passwords, JWT secrets, deploy keys, rclone configs. Never put a secret in code, tests,
  logs, commit messages, PR text, or chat.
- Never run anything against production: `ssh`, `scp`, `deploy/*.sh`, `docker compose` with
  `deploy/compose.prod.yml`, anything targeting `sanabelerp.com` or `81.208.167.28`.
- Never run migrations or raw SQL against any non-test database (`migration:run*`, `typeorm migration:*`,
  `psql` on anything but the local `charity_erp_test`).
- Never push to `main`, force-push, merge PRs, or change branch protection. The owner merges.
- Never disable, skip or weaken a test or a security gate to get green.
- Never claim the system is "secure", "unhackable" or "fully protected". Say what was reduced and what remains.

Production, financial-data and database operations always require explicit human approval in the
thread, and the `.claude/hooks/` enforce this mechanically.

## 2. Tenant isolation (critical)

- Every org-scoped controller method takes `@CurrentOrgUser() user: OrgUser` and passes
  `user.organizationId` down. Never accept `organizationId` from the request body, query or params.
- Every query on an org-scoped table filters by `organizationId` **in the same statement** — including
  `findOne({ where: { id } })`, updates, deletes, counts, raw SQL and report queries.
  Pattern: `findOne({ where: { id, organizationId: org } })` → 404 if missing (never 403, never reveal existence).
- Any foreign id written from client input (`unitId`, `accountId`, `projectId`, `supplierId`, …) must be
  loaded with the same `organizationId` before it is saved (see `hr/people.service.ts` `this.core.unit(org, id)`).
- A secondary lookup by an id read from an already-scoped row is acceptable, but prefer adding `organizationId` anyway.
- Platform admins (`isPlatformAdmin`, no organization) manage organizations only; they never read an
  organization's business data through module endpoints.
- Every new table that holds tenant data has `organization_id uuid NOT NULL` + index, and is added to the
  lifecycle export/delete lists in `core/lifecycle/org-data.ts` if not discovered automatically.
- Gate: `backend/test/security/tenant-isolation.e2e-spec.ts` must pass.

## 3. Authorization

- Every route declares exactly one decision, or the route-authz gate fails:
  `@RequirePermissions(...)`, `@RequireAnyPermission(...)`, `@Public()`, or `@AuthenticatedOnly('reason')`
  (any signed-in org user; ownership/membership is checked in the service — e.g. `/me`, meeting members).
- Permission codes are declared in the module manifest; never hardcode role names.
- `@Public()` routes are attack surface: rate-limit them (`@Throttle`), validate tokens (length ≥ 32 random
  bytes, expiry, single use where relevant), return a uniform response that does not reveal whether a record exists.
- Portal tokens (`typ: 'portal' | 'supplier'`) must never be accepted on staff routes, and vice versa.
- Segregation of duties: whoever creates a financial document must not be the one who approves it
  (vouchers, payments, bank accounts, supplier approval, PO approval, stock adjustments, budget transfers).
- Gate: `backend/test/security/route-authz.spec.ts`. Its baseline only shrinks; adding to it requires a human security review.

## 4. Financial integrity (critical)

- Double entry: every posted entry balances (sum debit = sum credit, both ≥ 0, no line with both).
  Use the ledger services; never write `acc_entries` / `acc_entry_lines` directly.
- Posted entries are immutable. Corrections are reversal + new entry, or the audited "unpost" flow in an open month.
  Nothing is ever hard-deleted after its number is reserved.
- Closed months/years reject every insert, update, unpost or cancel dated inside them.
- **Automatic entries belong to their source system** (fixed assets, stock, payroll, fundraising,
  procurement, billing). The accounting module shows them read-only; it never creates, edits or cancels them.
  Edits and cancellations happen only in the source, which regenerates its entry.
- Manual entries on control accounts (inventory, fixed assets, GRNI, payables control) are rejected.
- Subledgers (assets, warehouses) reconcile with their GL accounts; a difference shows a red flag with the reason.
- Money is `numeric` in SQL and handled as integer halalas or a decimal-safe helper in TS. Never float arithmetic
  for amounts that are stored or compared; round only at presentation.
- Concurrency: balance checks, reservations and number sequences run inside one transaction with
  `SELECT ... FOR UPDATE` (or an atomic `UPDATE ... RETURNING`) so two requests cannot both pass a check.
- Idempotency: payment callbacks and portal submissions must be safe to replay.

## 5. Restricted donations and budgets

- A restricted donation / funding batch may only be spent on the project/activity it is restricted to.
  Check the funding source **before** the budget line; if there is no funding source, budget overrun is not allowed.
- `reserved + spent <= amount` for every funding batch and budget line, enforced in the same transaction as the spend.
- Cancelling or reducing a commitment releases exactly what it reserved; returns "unspend" exactly what they consumed.
- Zakat funds only go to zakat-eligible activities and beneficiaries.
- Endowment (waqf) principal is never spent; only its permitted returns.

## 6. Auditability

- Every create/approve/reject/post/unpost/cancel/transfer/permission change records who, when, what,
  and the before/after values (existing per-entity history tables until the unified `audit_events` lands).
- Approval screens show the full record before the decision.
- Never log passwords, tokens, national IDs, IBANs or full request bodies.

## 7. Input, output and files

- DTOs with `class-validator` for every body/query; the global `ValidationPipe` uses `whitelist` + `forbidNonWhitelisted`.
  Never type a body as `any` or `Record<string, unknown>` and spread it into an entity.
- Raw SQL only with `$1` parameters. Interpolate identifiers only from internal constants, never from input.
  Sort/filter fields from the query string go through an allow-list.
- Frontend: no `v-html` except with explicitly escaped content; no `eval`, no `new Function`.
- Server HTML (reports, PDF, email) escapes every value with the existing `esc()` helper.
- Uploads: size and count limits, allow-listed MIME/extension, stored under `UPLOAD_DIR` with generated names,
  served only through an authorized, org-scoped endpoint with `Content-Disposition: attachment`.
- Outbound requests (webhooks, integrations, PDF rendering) never go to URLs supplied by users without an allow-list.

## 8. Auth and sessions

- Passwords: bcrypt cost ≥ 12, English-only, letter + digit, not containing the login name.
- Temporary passwords expire in 24h, are shown once, force a change, and end other sessions.
- Login and reset endpoints are rate-limited and answer uniformly.
- New sensitive capabilities (platform owner, org superadmin, financial approvers) are planned to require MFA — do not add bypasses.

## 9. Dependencies and supply chain

- Add a dependency only when necessary; prefer well-maintained packages; pin via the lockfile; run `npm audit`.
- No new high/critical advisories in production dependencies.
- Never add `postinstall` scripts or download-and-execute steps.

## 10. Database changes

- Schema changes only through new TypeORM migration files in `backend/src/migrations/`. Never edit a merged migration.
- Migrations must be reversible or explicitly documented as forward-only, and safe on existing data.
- You may create migration files and run them against the local test database only. The owner applies them in production.

## 11. Tests required for every change

- Typecheck: `cd backend && npm run typecheck`, `cd frontend && npm run typecheck`.
- Security gates: `npx jest test/security/route-authz.spec.ts` and
  `npx jest test/security/tenant-isolation.e2e-spec.ts` (needs local `charity_erp_test`).
- The module's own e2e spec. E2E specs share one database: run each file on its own (`npx jest test/<file>`).
- New endpoints: at least one test proving a user without the permission gets 403, and one proving another
  organization gets 404.
- Changes to any module update its `modules/demo/seed-*.ts`.

## 12. Product conventions

- All user-facing text is simple Modern Standard Arabic suitable for Saudi users (not Egyptian dialect), RTL.
- Each module has its own reports section; each approval screen shows the full item before deciding.
- Modular monolith: modules talk through exported services/ports, not by writing each other's tables.

## 13. Reviews

- Before opening a PR that touches auth, permissions, money, donations, procurement, inventory, payroll,
  migrations or portals, run the `sayed` security agent (`.claude/agents/sayed.md`) on the diff and address its findings.
- PR descriptions state the security impact and which gates were run.
