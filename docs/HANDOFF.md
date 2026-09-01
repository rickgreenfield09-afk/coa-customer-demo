# Handoff — COA Customer Demo

Standalone summary for picking this build up in a new Claude Code session. Read this
file first — it reflects the actual current state as of 2026-09-01, not the original
plan (a lot has changed/expanded since the first draft of this doc).

## What this is

A prospect-facing demo for "Axiom Forward Consulting" (fictional), showing off two
features destined for the real COA portal's "for purchase" customer module: a Contract
Financial Dashboard (CLIN/SLIN burndown, funding, ODC commitments) and a full Travel
Estimate/Expense Report workflow. Supabase + Vercel, no framework, no build step beyond
one tiny script that injects env vars at deploy time.

## Live services — everything below is actually deployed and working

- **App:** https://coa-customer-demo.vercel.app
- **GitHub:** https://github.com/rickgreenfield09-afk/coa-customer-demo (private repo).
  Commits must be authored as `rickgreenfield09-afk <278198456+rickgreenfield09-afk@users.noreply.github.com>`
  — Vercel's Hobby plan blocks deploys from a commit author it doesn't recognize as a
  collaborator (learned this the hard way; the fix is that exact author string).
- **Supabase:** https://zbcokdvluymdezvirmbq.supabase.co — all 9 migrations run
  successfully (see below). Custom SMTP is wired to **Resend** (fixes the default
  Supabase email rate limit) with sender `ricky.greenfield@axiomfwd.com` — a proper
  no-reply address was still pending as of last session.
- **Vercel env vars** (Project → Environment Variables): `SUPABASE_URL`,
  `SUPABASE_ANON_KEY` — read by `scripts/generate-env.js` (the `npm run build` command
  in `vercel.json`) to write `js/env.js` at deploy time. Locally, copy
  `js/env.example.js` to `js/env.js` (gitignored) and fill in the same two values to
  run `npx serve .` locally.
- **Supabase Edge Function `send-report`** — deployed, sends a sample dashboard report
  via Resend to the calling user's own email (never an arbitrary address). Secrets
  `RESEND_API_KEY` / `REPORT_FROM_EMAIL` are set on the Supabase project, not in this
  repo. To redeploy: `npx supabase functions deploy send-report` (needs
  `SUPABASE_ACCESS_TOKEN` env var or `supabase login` — a personal access token from
  supabase.com/dashboard/account/tokens is the non-interactive path).

## Migrations — all run, in this order, against the live project

| File | What it did |
|---|---|
| `0001_core_schema.sql` | Full initial schema + RLS (customers/contracts/billing_nodes/slins/funding/time_entries/travel/odc_commitments/personas/demo_employees/profiles). |
| `0002_persona_lifecycle.sql` | `clone_persona()` (security definer), demo-reset lifecycle (`reset_my_demo_session`, `admin_reset_all_demo_sessions`, `sweep_expired_demo_sessions` via pg_cron every 15 min, 2hr idle threshold), FK cascade/set-null fixes. |
| `0003_seed_demo_data.sql` | First seed pass — one contract, ~3.5yrs history, 2 template employees (Jordan Ellis/Morgan Reyes). |
| `0004_customer_admin_financial_rw.sql` | Widened Customer Admin's RLS write access from just `odc_commitments` to also `contracts`/`billing_nodes`/`slins`/`slin_funding_history`. |
| `0005_dashboard_read_visibility.sql` | Fixed `time_entries`/`travel_estimates`/`travel_expenses` SELECT policies from owner-only to read-all-authenticated — Customer Admin/Viewer had been seeing zero burn data. |
| `0006_theme_preference.sql` | `profiles.theme_preference` column for the light/dark toggle. |
| `0007_contract_contacts_and_fields.sql` | `contract_contacts` table + `issuing_organization`/`dpas_priority_rating`/`payment_terms` on `contracts`. |
| `0008_seed_expanded_dataset.sql` | Expanded seed to 4 contracts / 3 fictional issuing orgs (Solari Federal Solutions, Northgate Defense Group ×2, Vantage Point Systems) / 9 Task Orders / ~39 SLINs / 16 more template employees, via a reusable `_seed_task_order()` helper function (dropped at the end of the migration). |
| `0009_travel_module_expansion.sql` | Full per-diem/EWW/fee-multiplier calculator fields on `travel_estimates`/`travel_expenses`, `travel_estimate_audit_log`/`travel_expense_audit_log`/`travel_settings`/`travel_expense_receipts` tables, `travel-receipts` Storage bucket, widened write RLS (`is_employee_side_actor()`) so Supervisor can act on someone else's submission. |

**Gotchas hit while writing these** (useful if you're about to write SQL against this
project): Postgres has no `timestamp + integer` or `date + numeric` operator — always
cast date/interval arithmetic explicitly (`(x - y)::int`, `expr::date`) rather than
relying on implicit coercion, especially across `generate_series` and function-call
argument boundaries.

## What's built and working

- **Auth:** Supabase magic link, invite-only (`shouldCreateUser:false`), redirect URL
  now points at the Vercel domain (not localhost).
- **Role picker:** 4 personas — Employee, Supervisor (employee-category), Customer
  Admin, Customer Viewer (customer-category). `clone_persona()` clones a template
  `demo_employees` row for employee-side personas; upserts `customer_users` for
  customer-side.
- **Contract Financial Dashboard** (`js/dashboard.js`): redesigned to match an approved
  reference mockup — navy topbar with Customer/Contract/Task Order/SLIN-multiselect/
  Start-Date/End-Date filters, 6-tile KPI strip, Labor CLIN cards (progress bar + time
  gauge), Open ODC Commitments table, ODC CLIN gauge cards (horizontal layout), a
  hand-rolled SVG burn-up chart (Funded/Actual/EAC/Exhaustion lines), Forecast Summary
  bar with an "Email Me This Report" button. Layout uses CSS Grid (`#screen-home.active`)
  with exactly one flexible row — everything else is fixed/auto height so nothing gets
  squeezed out on short viewports (a real bug we hit and fixed: don't go back to nested
  flexbox with competing flex-shrink priorities for this screen).
- **Travel module** (`js/travel.js`, new 2026-08-31): full per-diem/EWW calculator
  ported from a sibling project (COA-pilot-portal) — structure/formulas only, no real
  company data. Workflow: Employee submits estimate → Supervisor approves internally →
  **Customer Admin gives final travel authorization** (this is the Prime/customer side,
  reusing the existing persona — no new persona was needed) → Employee expenses it →
  Supervisor approves reimbursement (single-stage, Customer Admin has no reimbursement
  role). Receipt uploads via the `travel-receipts` Storage bucket. Estimates carry a
  `slin_id` (added beyond the pilot portal's original schema) so travel cost rolls into
  the Dashboard's ODC burn.
- **Settings screen:** light/dark theme toggle, persisted to `profiles.theme_preference`.
- **Demo session lifecycle:** reset-on-logout + idle-timeout sweep, see 0002 above.

**Two real bugs just fixed (2026-09-01), worth double-checking if anything travel-related
looks broken next session:** `formatDate()` was called throughout `travel.js` but never
defined anywhere in this app (added to `js/app.js`, mirrors the pilot portal's UTC-safe
date parser) — and `#screen-travel` had a leftover inline `style="display:block"` that
permanently overrode the `.screen{display:none}` toggle, so Travel content was bleeding
onto every tab regardless of which was active. Both fixed and deployed; **not yet
re-confirmed by the user in a real end-to-end session** — that's the first thing to
verify next.

## Not yet built / logical next steps

- Guided workflow tour (single-tab, notification-driven, auto persona-switch).
- White-label settings (company name + logo upload to `org-logos` Storage bucket — not
  yet created).
- PDF export of the dashboard report (currently HTML email only, via `send-report`).
- Scheduled purge of inactive persona clones — separate from the idle-session sweep,
  not yet decided.
- Telemetry (`demo_events`) — table exists, nothing writes to it yet.
- End-to-end real-session test of the Travel module (estimate → supervisor approval →
  customer authorization → expense → reimbursement) hasn't been walked through by the
  user yet with the two 2026-09-01 fixes in place.

## Explicitly parked

- Indirect rate monitoring (Fringe/Overhead/G&A cascade) — pending a meeting for real
  COA process detail, not in the schema at all.
- EAC/Confidence formula on the dashboard is a placeholder, explicitly labeled as "not a
  signed-off estimating methodology" in the UI — real methodology TBD.

## Operational notes for whoever picks this up

- **git author:** see above — always `rickgreenfield09-afk <278198456+...@users.noreply.github.com>`,
  or Vercel deploys get blocked.
- **Deploy flow:** push to `main` → GitHub → Vercel auto-deploys → `npm run build` runs
  `scripts/generate-env.js` → static files served as-is (`outputDirectory: "."` in
  `vercel.json`, Framework Preset "Other" with Build/Output Command overrides explicitly
  toggled on in the Vercel dashboard — this did NOT work purely from `vercel.json` alone
  on this project, worth knowing if a deploy silently no-ops again).
- **Credentials pattern used throughout this build:** ask the user for a scoped
  access/API token (Supabase personal access token, GitHub PAT, Vercel token, Resend
  key), run CLI/API commands directly via Bash rather than walking the user through a
  terminal — this whole project was built with the user almost never touching a
  terminal themselves. Tokens are used live and not stored anywhere in the repo.
- **Testing without a real login:** the Browser tool can't complete Supabase magic-link
  OAuth, so functional testing was done by opening a blank tab, setting
  `document.getElementById('login-wrap').style.display='none'` +
  `#app-shell.classList.add('active')`, faking `currentProfile`/`currentPersonas`, and
  calling the relevant `load*()` function directly via `javascript_tool`. Useful pattern
  for catching rendering/syntax bugs before asking the user to test for real.
