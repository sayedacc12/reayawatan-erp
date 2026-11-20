# Incident response (short runbook)

Owner: platform owner. Keep this page short enough to follow under stress.

## 1. Detect
Signals: unusual 401/403/429 spikes, login alerts, a charity reporting data it should not see,
unexpected entries/approvals, backup failure email, GitHub secret-scanning alert, Dependabot critical.

## 2. Contain (first hour)
1. Stop the bleeding without destroying evidence: do **not** delete logs, containers or the database.
2. Suspected stolen staff account: suspend the user (Users screen) — sessions stop on the next request.
3. Suspected stolen JWT secret or server compromise: rotate `JWT_SECRET` in the server `.env`
   (invalidates every session), rotate `DB_PASSWORD`, SMTP app password, and deploy keys.
4. Suspected cross-tenant leak: put the platform in maintenance (stop the `backend` container) and keep the DB running.
5. Take an extra encrypted backup and copy server logs (`docker compose logs --since 72h > incident.log`).

## 3. Investigate
- Which accounts, organizations, records and time window. Use per-entity history and (once available) `audit_events`.
- Reproduce on a local copy, never on production. Add a failing test that proves the bug.

## 4. Recover
- Fix through a normal PR with security gates green; owner merges and updates the server.
- Restore data only from verified backups; reconcile ledgers and fund balances after any restore.

## 5. Notify
- Affected charities in writing, with what happened, what data, what was done, and what they should do.
- Saudi PDPL: personal-data breaches are reported to SDAIA (National Data Management Office) within 72 hours
  of becoming aware, and affected individuals are notified when there is risk to them. Confirm current rules with legal counsel.

## 6. Learn
- Short post-incident note in `docs/security/incidents/YYYY-MM-DD.md`: cause, impact, fix, new gate/test added.
