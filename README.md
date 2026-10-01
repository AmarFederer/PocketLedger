# PocketLedger

## Project Description

PocketLedger is a personal expense tracker that helps you understand where your money goes and plan your monthly spending. Record purchases, organize them by category, set budgets, and view spending summaries from a responsive dashboard.

You can explore the app locally with sample data without creating an account or configuring a database. Supabase authentication and cloud storage are also implemented, but their database migrations and end-to-end account flows still need integration testing. This is a development release; use synthetic data only, not real personal or financial information.

## Features

- **Spending overview:** See total expenses, monthly budget, remaining budget, and recent transactions.
- **Expense management:** Add, edit, and delete expenses.
- **Search and filters:** Find expenses by description, date, or category, with sorting and pagination.
- **Budget planning:** Set monthly limits and allocate budgets across categories.
- **Spending reports:** Explore spending activity and category breakdowns through charts.
- **CSV export:** Download expense records for use in a spreadsheet.
- **Categories and settings:** Archive categories and update profile preferences.
- **Account screens:** Sign up, sign in, complete onboarding, and recover a password when Supabase is configured.
- **Local demo:** Try the app with browser-local sample records and reset them in Settings.
- **Responsive interface:** Use the app on desktop and mobile screens.

## Technology Used

| Technology | Purpose |
| --- | --- |
| Next.js 16 and React 19 | Application framework and user interface |
| TypeScript | Type-safe application code |
| Tailwind CSS 4 | Styling and responsive layouts |
| Supabase | Authentication and PostgreSQL cloud storage |
| Recharts | Spending charts |
| React Hook Form and Zod | Form handling and validation |
| Radix UI and Lucide | Dialog components and icons |
| Vitest and Playwright | Unit tests and desktop/mobile browser tests |

## How to Install

### Prerequisites

- Node.js **22.12 or newer** and npm.
- Git and access to the [private GitHub repository](https://github.com/AmarFederer/PocketLedger).
- A modern browser that supports Web Locks, such as a current version of Chrome or Edge.

Clone the repository and install its dependencies:

```bash
git clone https://github.com/AmarFederer/PocketLedger.git
cd PocketLedger
npm ci
```

If you already have the project locally, open a terminal in its folder and run `npm ci`.

## How to Run Locally

### Option 1: Sample-data demo (recommended)

1. Copy [.env.example](.env.example) to a new file named `.env.local` in the project root.
2. Set this value in `.env.local`; leave the Supabase values empty:

   ```dotenv
   POCKETLEDGER_DEMO=true
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard).

The demo saves sample records in your browser's local storage. It does not create accounts or upload data to Supabase, and its records cannot be transferred to cloud mode. Production demo mode requires an additional explicit opt-in described below. Stop the server with `Ctrl+C`.

### Option 2: Supabase-backed development

1. Create a fresh development project in [Supabase](https://supabase.com/).
2. Apply these migrations in order using the Supabase SQL editor or your migration runner:
   - [Initial ledger schema](supabase/migrations/202610020001_initial_ledger.sql)
   - [Default currency update](supabase/migrations/202610020002_default_rupees.sql)
   - [Mutation input validation](supabase/migrations/202610020003_validate_mutations.sql)
3. Copy [.env.example](.env.example) to `.env.local` and configure:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
   POCKETLEDGER_DEMO=false
   ```

   Never use a service-role key here or commit `.env.local`.

4. Enable email confirmations and configure SMTP in Supabase Auth. Set the Site URL to `http://localhost:3000` and allow these redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/auth/callback?next=reset-password`
5. Run `npm run dev`, then open [http://localhost:3000](http://localhost:3000). Register a synthetic test account, verify its email, and complete onboarding.

Restart the development server after changing environment variables. Without demo mode or valid Supabase settings, the app displays an unavailable connection state.

Cloud mode requires additional database, authentication, and data-isolation testing before real use. Account deletion is currently disabled. See [PLAN.md](PLAN.md) for the full specification and production release requirements.

## Validation

```bash
npm test
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start an explicitly opted-in production demo on port 3100 using the preceding build. Keep that port free; an existing development server on port 3000 may remain running. Unit tests include mocked authentication/API failure handling, ledger-state synchronization, and migrations executed in an isolated embedded PostgreSQL database. These checks do not replace real Supabase signup, email recovery, session, concurrent-write, and two-account integration testing. Cloud release remains blocked until those checks pass.

## Live Application URL

**Public application:** [https://pocketledger-topaz.vercel.app](https://pocketledger-topaz.vercel.app)

Open the link to explore the dashboard, expenses, budgets, and reports without signing in. The hosted app uses synthetic demo data stored separately in each browser, not cloud accounts. Do not enter real personal or financial information.

### Deploy a public synthetic demo on Vercel

1. In [Vercel](https://vercel.com/new), import `AmarFederer/PocketLedger` from GitHub. Grant repository access if prompted.
2. Keep the Next.js framework preset and the repository root as the Root Directory.
3. Set these environment variables for Production and Preview:

   ```dotenv
   POCKETLEDGER_DEMO=true
   POCKETLEDGER_HOSTED_DEMO=true
   ```

4. Leave both Supabase environment variables unset. Hosted demo mode is rejected if either Supabase value is present.
5. Deploy the `main` branch and open the assigned HTTPS URL. Production deployments must be publicly accessible without Vercel authentication.

This deployment is a labelled synthetic-data demonstration, not a production financial service. Each browser has its own local records; there are no shared accounts or cloud persistence. Never enter real personal or financial information. For cloud deployment, disable both demo flags and complete the release requirements in [PLAN.md](PLAN.md).

- **Local demo:** [http://localhost:3000/dashboard](http://localhost:3000/dashboard) (available while the development server is running).
- **Source code:** [github.com/AmarFederer/PocketLedger](https://github.com/AmarFederer/PocketLedger) (private repository).

The local URL is not a hosted deployment and cannot be accessed by other users over the internet.
