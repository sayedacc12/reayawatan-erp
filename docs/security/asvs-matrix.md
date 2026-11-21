# OWASP ASVS 4.0.3 target

Target: **Level 2** for the whole platform, with **Level 3** items for accounting, fundraising,
procurement/inventory, payroll and platform administration (financial and personal data at scale).

Status legend: ✅ in place · 🟡 partial · ❌ missing · 📅 planned phase

| ASVS | Requirement (short) | Status | Evidence / plan |
|---|---|---|---|
| 1.1.2 | Threat model for design changes | 🟡 | `docs/security/threat-model.md` (phase 0) |
| 1.4.1 | Trusted, centralized access-control enforcement | 🟡 | Global `AuthGuard`; default-deny 📅2 |
| 1.14.6 | No unsupported/insecure client tech | ✅ | Vue 3 SPA |
| 2.1.1/2.1.7 | Password length; breached-password check | 🟡 | Length + letter/digit; breached list ❌ |
| 2.2.1 | Anti-automation on auth | 🟡 | `@Throttle` on login/reset per real client IP; monitor blocks brute-force/spraying sources temporarily |
| 2.2.3/2.5.x | Notify on credential change; secure recovery | 🟡 | Temp password flow (PR #54); email notice 📅4 |
| 2.7/2.8 (L3 for admins) | MFA (TOTP) | ❌ | 📅4 platform owner, superadmin, financial approvers |
| 2.4.1 | Passwords stored with adaptive hash | ✅ | bcrypt cost 12 |
| 3.2.1/3.3.1 | New token on login; logout/expiry invalidates | ✅ | JWT `ts` + `sessionsValidAfter` |
| 3.4.x | Cookies HttpOnly/Secure/SameSite | ❌ | Token in localStorage; 📅4 |
| 3.5.3 | Signed stateless tokens, no `none` alg | 🟡 | HS256 single secret; per-type secret/audience 📅1 |
| 4.1.1/4.1.3 | Access control enforced server-side, least privilege | ✅ | Permissions per module/role |
| 4.1.5 | Fail securely | 🟡 | Undecided routes allowed for any staff; gate in CI (phase 0), default-deny 📅2 |
| 4.2.1 | IDOR protection | 🟡 | Service filters; isolation gate (phase 0); RLS 📅2 |
| 4.3.1 | Admin interfaces use MFA | ❌ | 📅4 |
| 5.1.3/5.1.4 | Input validation, allow-lists | ✅ | Global `ValidationPipe` whitelist/forbid |
| 5.2.x | Sanitize HTML | ✅ | Escaped `v-html`, `esc()` in reports |
| 5.3.4 | Parameterized queries | ✅ | Semgrep rule blocks new interpolation |
| 7.1.1/7.1.2 | No credentials/PII in logs | 🟡 | Rule in CLAUDE.md; review |
| 7.2.1/7.2.2 | Log auth and access-control events | 🟡 | Security monitor `sec_events` (logins, 401/403/404/429/5xx, exports, admin changes) with alerts; unified `audit_events` 📅3 |
| 7.3.x (L3) | Log integrity | ❌ | Hash-chained audit log 📅3 |
| 8.2.2 | No sensitive data in browser storage | ❌ | JWT in localStorage 📅4 |
| 8.3.x | Sensitive data minimized/encrypted | 🟡 | Backups encrypted; field-level encryption for IBAN/ID to evaluate |
| 9.1.1 | TLS for all connections | ✅ | Caddy + Let's Encrypt |
| 9.1.x | HSTS | ✅ | Caddy (phase 1) |
| 10.3.2 | Dependency integrity / known vulns | 🟡 | Lockfiles; audit gate + Dependabot (phase 0); upgrades 📅1 |
| 11.1.1/11.1.4 | Business-logic sequence and limits | 🟡 | Approval flows; concurrency tests 📅3 |
| 11.1.6 (L2) | Race conditions on financial ops | 🟡 | Transactions; DB constraints 📅3 |
| 12.1.1 | Upload size limits | ✅ | Multer limits |
| 12.2.1 | Verify file type by content | ❌ | 📅 later |
| 12.5.2 | Uploads served as attachments, not executed | ✅ | Served via API |
| 12.6.1 | SSRF protection | ✅ | PDF renderer blocks all network requests (phase 1, test-guarded) |
| 13.1.x | API authz, rate limits | ✅ | Guard + throttler |
| 14.1.x | Build/deploy reproducible, secure | 🟡 | Docker, CI gates (phase 0), no deploy from CI |
| 14.2.1 | Components up to date | 🟡 | High advisories 14 -> 1 (no fix, unreachable); Nest 11 upgrade pending |
| 14.4.x | Security headers (CSP, XFO, nosniff, Referrer-Policy) | 🟡 | All enforced except CSP (report-only), phase 1 |
| 14.5.x | Validate HTTP request headers / trusted proxy | ✅ | Private-hop trust only (phase 1, test-guarded) |
