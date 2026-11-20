# Sanabel threat model

Living document. Update it when a module, portal, integration or trust boundary is added.
Method: STRIDE per trust boundary, prioritised by impact on money, donor restrictions, personal data and tenant isolation.

## Assets (by impact)
1. Ledger integrity: journal entries, vouchers, balances, closed periods.
2. Restricted funds: funding batches, reservations, zakat and waqf rules, budget availability.
3. Tenant data isolation: every charity's beneficiaries, donors, employees, suppliers.
4. Personal data: national IDs, phone numbers, IBANs, salaries, medical/social research.
5. Credentials and sessions: staff, platform owner, beneficiary portal, supplier portal tokens.
6. Platform secrets on the server: JWT secret, DB password, SMTP app password, backup encryption key.
7. Availability: single production server, daily encrypted backups.

## Actors
- Anonymous internet users (public site, portals' login/registration, signing links, payment links).
- Beneficiaries and suppliers (portal tokens, limited to their own records).
- Charity staff with module permissions; charity superadmin.
- Platform owner (manages organizations; must not read their business data).
- Malicious insider at one charity trying to read/alter another charity or bypass approvals.
- Compromised dependency or CI action; compromised developer/AI-agent session.

## Trust boundaries and main threats

| Boundary | Threats (STRIDE) | Controls today | Planned |
|---|---|---|---|
| Internet → Caddy → nginx → API | DoS, brute force, XSS, clickjacking | TLS (Caddy), throttler, ValidationPipe | Real client IP (phase 1), security headers (phase 1), WAF/CDN |
| Staff session → API | Spoofing via stolen token, elevation via missing permission | JWT 8h, per-request permission reload, `sessionsValidAfter` | MFA for owners/approvers, HttpOnly cookie, default-deny routes |
| Org A user → Org B data | Information disclosure, tampering (IDOR) | `organizationId` filters in services, org-scoped foreign-id checks | PostgreSQL RLS, non-superuser DB role, isolation gate in CI |
| Portals (beneficiary/supplier) → API | Token confusion, enumeration | `typ` claim, separate guards, uniform responses | Separate secrets/audience per token type |
| Public signing/payment links | Token guessing, replay | Random tokens, throttling | Expiry + single use audit, length check in gate |
| Source modules → ledger | Tampering with automatic entries | Source ownership in services | DB triggers: balance, immutability, closed periods |
| Spending → restricted funds | Over-spend, mis-allocation | Service checks (funding source first) | DB constraint `reserved + spent <= amount` |
| Server-side PDF (Chromium) | SSRF to cloud metadata | Escaped HTML | Block all network requests (phase 1) |
| Attendance devices `/iclock` | Spoofed punches | Serial number lookup | Per-device secret (phase 1) |
| CI / dependencies | Supply-chain compromise | Lockfiles | npm audit gate, Dependabot, Semgrep, Gitleaks, Trivy |
| Developer / AI agent | Secret exfiltration, prod changes | — | CLAUDE.md, `.claude/settings.json` deny rules, hooks, `sayed` review |
| Backups | Theft, ransomware | rclone crypt, two destinations, restore test | Key rotation procedure, immutable bucket retention |

## Abuse cases to keep testing
- Staff of org A calls any GET/PUT/POST with an id from org B → must be 404 (gate covers GET).
- User without permission calls approval endpoints → 403.
- Creator approves own voucher/PO/transfer → rejected.
- Two concurrent spends against the last riyal of a restricted batch → only one succeeds.
- Edit/cancel an automatic entry from accounting → rejected.
- Post into a closed month → rejected.
- Portal token used on staff API (and vice versa) → 401.
