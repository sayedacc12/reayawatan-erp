# Security policy

## Reporting a vulnerability
Please do not open a public issue. Report privately through GitHub's
"Report a vulnerability" (Security tab) on this repository, or contact the platform owner directly.
Include the affected URL/endpoint, steps to reproduce, and impact. We acknowledge within 3 business days.

Please do not access, modify or delete other organizations' data, and do not run denial-of-service
or automated scanning against production (sanabelerp.com) without written permission.

## How we build securely
- Mandatory secure-coding rules: [`CLAUDE.md`](CLAUDE.md)
- Threat model, ASVS target and incident runbook: [`docs/security/`](docs/security/)
- CI security gates: `.github/workflows/security.yml` (authorization coverage, tenant isolation,
  Semgrep, Gitleaks, dependency audit, Trivy)

No system is completely secure. These controls reduce risk; they do not eliminate it.
