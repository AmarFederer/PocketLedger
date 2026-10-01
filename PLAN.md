# PocketLedger Development Plan

## Application Name
PocketLedger: a responsive personal expense and monthly budget tracker.

## Problem Statement
Spending records scattered across receipts, notes, and spreadsheets make it difficult to understand monthly spending and spot budget overruns. Provide a private place to record expenses, categorize spending, set budgets, and inspect trends.

## Target Users
Individuals, including students, salaried workers, and freelancers tracking personal expenses. Each account owns a private ledger. Business accounting and shared households are outside the MVP.

## Main Features
- Email/password signup, sign-in, verification, sign-out, and password recovery.
- Add, edit, and delete expenses with amount, date, category, merchant, and notes.
- Search, filter, sort, paginate, and export matching expenses as CSV.
- Default and custom categories; archive categories without losing history.
- Overall and category-level monthly budgets with spending comparisons.
- Dashboard and reports with accessible chart alternatives.
- Profile settings, one ledger currency, and confirmed account deletion.
- Responsive layouts, keyboard access, and empty/loading/error states.
- AI assists development only; no AI APIs or in-product AI features.

## Pages and Screens
- Sign In, Sign Up, Forgot Password, Reset Password.
- Onboarding: profile and currency selection.
- Dashboard: spending summary, recent expenses, category breakdown.
- Expenses: searchable list and add/edit dialog.
- Budgets: monthly overall and category limits.
- Reports: monthly trends, category breakdowns, CSV export.
- Settings: profile, categories, currency rules, account deletion.
- Auth callbacks, not-found, and recoverable error screens.

## Technology Stack
- Next.js App Router, React, and TypeScript; one application, no separate Express service.
- Tailwind CSS, accessible Radix/shadcn-style primitives, Lucide icons.
- Supabase PostgreSQL and Auth with cookie-based server authentication.
- React Hook Form and Zod for client and server validation.
- Recharts for reports with accessible data tables.
- Vitest for unit tests, Playwright for browser acceptance checks, ESLint and TypeScript.
- GitHub Actions for CI, Vercel for application hosting, separate Supabase development and production projects.

## Project Folder Structure
```text
.
|-- PLAN.md
|-- README.md
|-- .env.example
|-- src/
|   |-- app/                  # routes, layouts, server endpoints
|   |-- components/           # shared UI and application shell
|   |-- features/             # expenses, budgets, reports, settings
|   `-- lib/                  # auth, database, money, dates, CSV
|-- public/                   # static assets
|-- supabase/migrations/      # schema, constraints, RLS, database functions
|-- tests/e2e/                # browser workflows
`-- .github/workflows/ci.yml
```
Colocate unit tests with their modules. Commit one npm lockfile. Keep secrets out of version control.

## Data That Needs to Be Stored
- Supabase Auth identities: managed credentials and email lifecycle, never custom password storage.
- Profiles: user ID, display name, currency code, IANA time zone, onboarding status, persistent currency-lock flag, version, timestamps.
- Categories: ID, user ID, name, color, archive timestamp; unique names per user.
- Expenses: ID, owner, category, positive amount in integer minor units, date-only expense date, merchant, notes, version, timestamps.
- Monthly budgets: ID, owner, first day of month, positive overall limit, timestamps; unique per owner/month.
- Category budgets: owner, monthly budget, category, positive limit; unique per budget/category.
- Version mutable categories and monthly budget aggregates. Store owner-scoped mutation receipts containing operation, idempotency key, request hash, result reference/status, and seven-day expiry, without financial payloads.
- Derive report totals from expenses rather than storing duplicate aggregates.

Use integer minor units and an explicit supported-currency list; never use floating-point currency arithmetic. Lock currency after financial records exist. Composite foreign keys enforce common ownership. Enable row-level security for every application table. Validate all writes on the server and in the database. Serialize budget changes and reject category allocations above the overall limit. Archive categories rather than deleting history. CSV export must escape fields and neutralize spreadsheet formula injection.

## Development Steps
1. Save this plan; initialize Next.js, TypeScript, lint, tests, CI, and documentation.
2. Create database migrations, constraints, ownership policies, default categories, currency locking, and atomic budget operations. Verify isolation between two accounts.
3. Implement authentication, protected routes, recovery, verification callbacks, and onboarding.
4. Build expense and category CRUD, precise money/date utilities, filters, sorting, and pagination. Establish a working vertical slice before reports.
5. Implement overall/category monthly budgets and allocation validation.
6. Build dashboard, reports, and CSV export using shared filtering logic. Expense tracking is a dependency; remaining-budget summaries also depend on budgets.
7. Complete settings, confirmed account deletion, responsive navigation, and accessible states.
8. Run unit/browser tests, lint, type checks, production build, and security checks. Test desktop/mobile and keyboard flows.
9. Deploy staging, verify hosted authentication and persistence, then release production.

Use AI on one scoped slice at a time, review generated security and money logic, and validate before progressing. Use synthetic data only in prompts and tests. Apply the safeguards below in the corresponding development steps, not as post-release additions.

## Financial Rules
- Support USD, EUR, GBP, and INR with two decimal places; JPY with zero. Parse decimal strings into minor units; reject excess precision, scientific notation, zero, negative values, and malformed input rather than silently rounding.
- Cap each expense/budget at 1,000,000,000 minor units. Use BIGINT storage and exact checked aggregates; never convert out-of-range totals into unsafe JavaScript numbers.
- Lock currency permanently after the first expense or budget, even after records are deleted. No currency conversion.
- Derive today in the profile's validated IANA time zone. Reject impossible/future expense dates on the server. Store date-only values; changing time zone must not shift historical dates.
- Refunds and negative entries are excluded. Correct erroneous entries through edit/delete; spending totals are not net cash flow.
- Budgets apply to one calendar month without rollover or automatic copying. No budget means not set, not zero. Removing a budget removes allocations, never expenses.
- Reject overall limits below existing allocations. Allow actual overspending with visible warnings, not blocked expense entry.
- Archived categories retain historical records and existing allocations; reject new assignments. Editing unrelated fields may retain an expense's archived category.

## Reliable Writes and Conflicts
- Give every intended mutation an owner-scoped idempotency key. Atomically persist its receipt and result with the write. Identical retries return the prior outcome; changed payloads with the same key conflict. Separate keys may represent legitimate identical purchases.
- Disable pending submissions and use bounded transient retries with the original key. After receipt expiry, require checking records and explicit resubmission; never automatically replay expired requests.
- Require the last-read version for updates/deletes. Reject stale writes and prompt reload/reapply rather than overwriting another tab's edits.
- Serialize/version monthly budget changes in one transaction. Database grants must prevent direct writes bypassing protected routines, ownership, idempotency, or allocation validation.

## Authentication Safeguards
- Require verified email, authenticated server operations, and RLS. Never trust client-supplied ownership.
- Allowlist verification/reset destinations, reject external redirects, and apply same-origin/CSRF protection to mutations. Keep administrative credentials server-only.
- Refresh valid sessions through supported cookie handling. If refresh fails, stop protected requests and return to sign-in without persisting sensitive drafts. Clear user caches on logout/account switching.
- Use provider safeguards and distributed application limits. Initial targets: five failed sign-ins per 15 minutes per account/IP pair, three recovery emails per hour per account, 60 mutations/minute/user, and five exports/minute/user, with additional IP abuse protection. Return generic recovery responses and safe retry guidance.
- Deletion requires explicit confirmation and fresh credential verification within five minutes. A refreshed session is not reauthentication; never log credentials.

## Privacy and Deletion
- Publish a privacy notice before signup covering stored fields, providers, selected region, retention, deletion, and support contact. Confirm launch jurisdictions and applicable requirements before public release.
- Successful deletion removes live identity and owned data, revokes access, and clears caches. Make cleanup retryable/idempotent; never report success after partial failure.
- Retain redacted application logs at most 30 days; exclude credentials, tokens, emails, merchants, notes, amounts, and export contents.
- Target encrypted backup expiry within 30 days; verify provider retention and disclose exceptions before launch. Do not promise immediate backup erasure.
- Keep a minimal restricted deletion record without financial payloads until the backup window expires; reapply deletions before reopening restored databases.
- CSV is an expense export, not a complete account backup. Document a support process for broader data-access requests.

## Milestones and Operating Targets
- Foundation exit: reproducible install, environment setup, CI, lint/typecheck/build pass.
- Secure data/auth exit: reproducible migrations, two-user isolation, signup/recovery, expired sessions, callbacks, cache clearing, and rate limits pass.
- Tracking exit: exact money/date tests, expense/category/budget flows, idempotent retries, stale-write rejection, and concurrent allocation tests pass.
- Product exit: reconciled reports, complete filtered exports, accessible mobile/keyboard flows, verified deletion/retention.
- Release exit: required gates, staging smoke tests, measured performance, restore rehearsal, approved costs/privacy, alerts, and rollback documentation. Estimate dates once developer capacity and service access are known.
- Initial assumptions: 1,000 registered users, 100 active users, 10,000 expenses per ledger. Use indexed queries, server pagination, bounded exports, and a repeatable staging load profile.
- Targets: p95 list/report under two seconds, warm mutations under one second, errors below one percent; report cold starts separately. Target LCP <=2.5 seconds, INP <=200 ms, CLS <=0.1 and WCAG 2.2 AA with automated and manual checks.
- Provisional allowance: USD 100/month, not a provider quote. Record dated hosting, database/backups, email, rate-limit storage, monitoring, domain, and overage estimates; obtain approval if required services exceed it. Set available 50/80/100 percent cost alerts; document manual checks otherwise.
- Assign an operational owner. Alert on sustained server errors above one percent for five minutes with at least 100 requests, outages, failed migrations, overdue backups, and failed cleanup jobs; never include financial payloads.
- Provisional recovery objectives: <=24 hours data loss and restoration within eight hours. Validate in a timed rehearsal or obtain approval for different objectives.

## Demo Mode Boundary
- Optional local demo is disabled by default and explicitly opted into. A public hosted synthetic demonstration additionally requires `POCKETLEDGER_HOSTED_DEMO=true` and both Supabase settings to be absent. Persistently label it, use synthetic data only, provide reset, and isolate its storage from real accounts.
- No demo-to-account migration. Missing Supabase configuration must fail closed, never silently activate a demo. Verify production rejects demo mode without both explicit flags and rejects hosted demo mode alongside any Supabase configuration.

## Verification Criteria
- Exact decimal parsing, currency precision, invalid amounts, safe ranges, totals, and CSV safety.
- Date-only behavior, month boundaries, pagination, filtering, and export of all matching records.
- Anonymous access rejection, cross-account isolation, ownership foreign keys, currency locking, archived-category rules, and concurrent budget validation.
- Idempotent retries, changed-payload conflicts, expired receipts, stale edits/deletes, future dates, no rollover, and permanent currency locking.
- Callback/CSRF/expiry/rate-limit checks, fresh deletion verification, cache isolation, deletion retries, retention, restore-time deletion, and hosted demo opt-in/isolation.
- Browser flows for expenses, budgets, reports, settings, authentication, recovery, and account deletion.
- Desktop/mobile screenshots, keyboard navigation, readable charts and tables, empty/loading/error states.
- Measured load/performance and WCAG 2.2 AA acceptance against the stated targets.
- Required gates: lint, typecheck, unit tests, production build, and browser acceptance tests.

## Deployment Approach
- Deploy Next.js to Vercel from reviewed changes with passing GitHub Actions CI.
- The public synthetic demonstration may use the two explicit demo flags without Supabase; it is not a release of the cloud financial service.
- Use separate development and production Supabase projects; previews must never access production financial data.
- Apply versioned migrations before dependent releases; use backward-compatible migrations for rollback.
- Configure project URL and publishable key; keep administrative keys server-only, never in public environment variables.
- Configure exact authentication callback/reset URLs and production email delivery.
- Use HTTPS, redact financial data and tokens from logs, and maintain dependencies.
- Choose a Supabase backup/PITR plan or scheduled encrypted backups; verify retention and rehearse restoration outside production.
- For cloud releases, disable both demo flags and configure cleanup/retention jobs, distributed limits, security headers, redacted monitoring, and alert ownership. Record approved costs, provider limits, data region, support contact, retention, and measured recovery objectives.
- Roll back application releases through Vercel; document a separate database recovery procedure.

## Scope Boundaries
Excluded from the MVP: bank integrations, receipt OCR/storage, AI features, income accounting, shared ledgers, refunds/negative entries, reimbursements, subscription billing, notifications, recurring automation, budget rollover, currency conversion, offline sync, native mobile apps, CSV import, and demo-to-account migration.