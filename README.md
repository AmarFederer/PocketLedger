# PocketLedger

A personal expense tracker built with Next.js, React, TypeScript, Supabase, and Tailwind. AI assists development; there are no AI product features. The specification and release requirements are in [PLAN.md](PLAN.md).

## Development Status

This is a development release, not a production-ready financial service. The browser-local synthetic demo is runnable and tested. Cloud authentication and persistence are wired, but the migration and real Supabase flows have not been executed or integration-tested. Use synthetic data until those checks and the release gates below are complete.

Implemented screens: Overview, Expenses, Budgets, Reports, Settings, Onboarding, Sign In, Sign Up, and password recovery. Demo workflows include expense creation/editing/deletion, search/date/category filters, sorting, pagination, CSV export, category archiving, monthly/category budgets, and profile settings.

## Run the Synthetic Demo

Use Node.js 22.12 or newer and npm:

```bash
npm ci
POCKETLEDGER_DEMO=true npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard). The demo is explicitly labelled, stores synthetic records only in browser local storage, and can be reset in Settings. It is ignored when `NODE_ENV=production`, does not create accounts, and cannot migrate to cloud mode. It requires a modern browser with Web Locks on localhost or HTTPS. Never enter real personal or financial data into the demo.

Without demo mode or database environment variables, the app shows an unavailable connection state. There is no silent fallback to sample data.

## Configure Supabase

1. Create a fresh Supabase project in an approved region. The migration initializes newly created accounts; existing accounts require a separately reviewed backfill.
2. Apply [the initial migration](supabase/migrations/202610020001_initial_ledger.sql) through Supabase's SQL editor or your established migration runner. Validate it on a disposable project first.
3. Create a local `.env.local` using the keys in [.env.example](.env.example). Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, with `POCKETLEDGER_DEMO=false`. Never put a service-role key into the app or a public environment variable.
4. Enable email confirmations in Supabase Auth, configure SMTP, and allowlist the exact application `/auth/callback` URL plus `/auth/callback?next=reset-password` for recovery. Configure the application's origin as the Site URL, and use separate development and production projects.
5. Start `npm run dev`, register a synthetic test account, verify its email, and complete onboarding. Test signup, recovery, logout, expired sessions, cross-user isolation, direct database-write denial, retries, stale revisions, and concurrent budget changes before using real data.

The migration defines profiles, categories, expenses, monthly budgets, allocations, and mutation receipts. Tables enable RLS and deny direct access to `anon` and `authenticated`; authenticated access is through verified-user RPCs. The mutation RPC locks the owner profile, checks idempotency before revision conflicts, and saves budget allocations atomically. Amounts use integer minor units and currency remains locked after the first financial write. Successful mutations are limited to 60 per user per minute; this is not a substitute for distributed abuse prevention.

## Validation

```bash
npm test
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit tests cover money precision, date boundaries, currency locking, category archiving, budget invariants, filters, CSV safety, and demo-mode isolation. Playwright exercises the synthetic demo on desktop and mobile, including expense CRUD/persistence/export, budget validation, navigation, chart rendering, and page overflow. Screenshots and failure traces are written to the ignored `test-results/` directory. Browser tests use port 3100; avoid running a different app on that port.

CI runs these checks with Node.js 22. Database isolation and concurrency tests are still outstanding; application tests do not certify the SQL migration.

## Production Release Gates

- Execute and review the migration and multi-account authorization/concurrency tests, including malformed direct RPC calls.
- Implement account deletion with fresh credential verification, retries/reconciliation, and restore-time reapplication. Account deletion is deliberately disabled in this build.
- Establish the privacy notice, legal/region review, log redaction and retention, backup retention, and restore procedure.
- Schedule deletion of expired mutation receipts after seven days; the current migration rejects expired retries but does not schedule cleanup.
- Add distributed authentication/export/abuse limits, monitoring, CSP and deployment security review, password-recovery session review, and alert ownership.
- Replace full-ledger snapshots with server-side paginated/filterable reads before validating the planned data volume. Complete reports, load/performance targets, and WCAG 2.2 AA audits.

Deploy to Vercel only after the relevant gates in [PLAN.md](PLAN.md) are met. Configure production Supabase environment variables, exact HTTPS callback allowlists, and database migrations independently. `npm run build` followed by `npm start` runs the production app locally; production never permits demo mode.
