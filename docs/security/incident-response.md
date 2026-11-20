# Incident response (short runbook)

Owner: platform owner. Keep this page short enough to follow under stress.

## 1. Detect
Signals: unusual 401/403/429 spikes, login alerts, a charity reporting data it should not see,
unexpected entries/approvals, backup failure email, GitHub secret-scanning alert, Dependabot critical.

The in-app security monitor ("sayed", `/platform/security`, `backend/src/core/security/`) does the first pass:

| Rule | Window | Automatic response (only on the attacking source) |
|---|---|---|
| Brute force / password spraying from one IP | 10 min | Temporary IP block (default 60 min). Never for private, trusted, or recently-used staff IPs: alert only. |
| One account attacked from many IPs | 1 h | Alert only |
| Scanner (many rejected requests on ≥10 distinct paths, no session) | 5 min | Temporary IP block (same exceptions) |
| Signed-in account requesting many records it cannot see (IDOR probing) | 10 min | End that account's sessions; **suspension waits for the owner's approval** |
| Successful login from an IP that was spraying passwords | 1 h | End the account's sessions (unless the IP is known); suspension waits for approval |
| Platform admin / org superadmin signs in from a new IP | 90 days history | Alert only |
| Server-error spike | 10 min | Alert only |
| Mass export by one account | 1 h | Alert only |

Every incident emails the recipients once (deduplicated for 6 h), every action is recorded on the incident,
and every block or suspension can be undone from the screen. The monitor never stops a module or the platform.
A daily report (07:00 Riyadh by default) covers performance, backups, security events, incidents, blocks and recommendations.
Events keep 90 days; no passwords, tokens or request bodies are stored (the staff login name is, for failed logins).
Gate: `backend/test/security/security-monitor.e2e-spec.ts`.

## 2. Contain (first hour)
1. Stop the bleeding without destroying evidence: do **not** delete logs, containers or the database.
2. Suspected stolen staff account: approve the pending suspension on `/platform/security`, or suspend the user
   (Users screen) — sessions stop on the next request.
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
