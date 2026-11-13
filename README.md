# Charity ERP (WIP)

Modular-monolith ERP for charities, multi-tenant SaaS. Work in progress: the
foundation (SSO, platform/association admins, roles & per-module permissions,
per-association module enablement) is in `backend/` (NestJS + PostgreSQL) and
`frontend/` (Vue 3, Arabic RTL).

Status: paused pending the stack decision (NestJS vs. building on Odoo Community).

Backend: `cd backend && cp .env.example .env && npm i && npm run start:dev`
Tests: `npm test` (needs a PostgreSQL test DB, see `test/app.e2e-spec.ts`).
Frontend: `cd frontend && npm i && npm run dev`
