# Handoff — COA Customer Demo

Full design history lives in the Claude project ("COA self service portal", docs
`demo-portal-design.md` and `ssp-log.md`). This file is the standalone summary for
picking the build up in Claude Code.

## What this is

A prospect-facing demo of two features destined for the real COA portal's "for
purchase" customer module: a Contract Financial Dashboard (CLIN/SLIN burndown, funding,
ODC commitments) and the Travel estimate/reimbursement workflow. Seeded with 3-4 years
of fake data for a fictional company, "Axiom Forward Consulting." Fully standalone —
Supabase + Vercel, no dependency on the GCC-track Azure build.

## Live services

- Supabase project: https://zbcokdvluymdezvirmbq.supabase.co (anon key is in
  `js/supabaseClient.js`'s expected `window.__ENV__` shape — not yet wired to a real
  value in this repo; inject at deploy time).
- GitHub repo: this one.
- Vercel project: not yet created.

## Running the migrations (not yet done against the live project)

Two migration files, run in this exact order, both via the Supabase SQL Editor for
https://zbcokdvluymdezvirmbq.supabase.co (SQL Editor > New Query > paste > Run):

1. **`supabase/migrations/0001_core_schema.sql`** — run this first, in full, top to
   bottom, exactly once. Creates every table, function, and RLS policy from scratch.
   Only safe to run against a fresh project with none of these tables already present.
2. **`supabase/migrations/0002_persona_lifecycle.sql`** — run this second, immediately
   after 0001 succeeds, in full, top to bottom, exactly once. Alters four tables' foreign
   keys (adds `on delete cascade`/`set null` behavior) and adds the persona-clone and
   demo-reset functions. Requires the `pg_cron` extension enabled first — **done** as of
   2026-08-30 (Database > Extensions). If this migration is ever re-run against a project
   where it already succeeded, the `cron.schedule(...)` call at the bottom will error
   ("job already exists") — that's expected; either skip re-running it or call
   `cron.unschedule('sweep-expired-demo-sessions')` first.

After both run, verify: `select * from cron.job;` in the SQL Editor should show one row
named `sweep-expired-demo-sessions` running every 15 minutes.

No further SQL needs to be run manually beyond these two files for the current build
phase — the seed script (next up) will be its own file, run the same way (SQL Editor,
service role context), and I'll call it out explicitly when it's ready.

## Schema

`supabase/migrations/0001_core_schema.sql` — key design decisions baked into it:

- **CLIN/SLIN** is one concept with a display label set per contract
  (`contracts.line_item_label`), not a structural split.
- **Burndown** reads the latest `slin_funding_history.cumulative_total` per SLIN as the
  funded ceiling; actual burn = `time_entries` (hours × `employee_rates.bill_rate_with_fee`)
  + fee (`× slins.fee_percentage`) + ODC (travel + `odc_commitments` actuals). Projection
  logic (trailing-average burn rate, run-out date vs. `pop_end`) is application-layer,
  not in the schema.
- **ODC Commitments** (`odc_commitments`) cover the full "commit then close" lifecycle in
  one row — open with an estimate, close with the actual amount/date. This is also where
  non-travel ODC actuals get recorded at all.
- **Persona/"assumed identity" model:** `demo_employees` rows with `owner_profile_id
  null` are templates (seeded history, read-only); on first role selection a clone
  function (not yet written) copies a template row plus its `time_entries`/
  `travel_estimates` into new rows owned by the guest. Customer-side personas
  (`customer_users.role`) don't clone anything — they view shared contract data scoped
  by which `customer_id` the guest is acting as.
- **Travel** ties to a SLIN via `travel_estimates.slin_id`/`travel_expenses.slin_id` so
  it rolls into ODC burndown; an approved-but-not-expensed estimate is the "Committed"
  side, an expensed one is "Actual" — no separate commitments table needed for travel.

RLS is Supabase-native (`auth.uid()`), not the session-variable pattern used on the
GCC-track build (that pattern was required there because Azure Functions sits between
Entra ID and Postgres; Supabase's PostgREST layer means native RLS works directly here).

**Known gaps in 0001, resolved by 0002:** the persona-clone operation is now
`clone_persona(persona_id)`, a `security definer` function — a guest can no longer clone
an arbitrary `demo_employees` row via a raw client insert. Demo-session lifecycle (see
below) is also handled there. **Still open:** open/close write-permission split on
`odc_commitments` (current RLS treats open/edit/close the same — left as-is, low risk for
a sales demo); the seed script still needs to run as the service role to populate
template data (unchanged, not a bug — just not written yet).

## Persona role split (confirmed 2026-08-30, `0004_customer_admin_financial_rw.sql`)

- **Employee** — logs time, submits travel estimates/expenses for themselves.
- **Supervisor** — everything Employee can do, plus approves travel for their team.
- **Customer Admin** — full read/write on the Contract Financial Dashboard: contracts,
  SLINs, funding mods, and ODC commitments (open/close), scoped to their own
  `customer_id`. (0001 only gave this role write access to `odc_commitments` — 0004
  extended it to `contracts`/`billing_nodes`/`slins`/`slin_funding_history` to match.)
- **Customer Viewer** — strictly read-only on the same dashboard. No RLS write policy
  ever matches this role — confirmed, not something that needed a fix.

`labor_categories`/`employee_rates` (Axiom Forward's internal billing-rate data) stay
platform-admin-only — not extended to Customer Admin, since a client-side persona editing
the consultancy's own internal rates doesn't make sense for this demo.

## Demo session lifecycle (added 2026-08-30, `0002_persona_lifecycle.sql`)

Guests can freely create/edit data while exploring the demo, but none of it should ever
need manual grooming afterward — it resets to the seeded baseline automatically:

- **Explicit logout:** the client must call `reset_my_demo_session()` (RPC) immediately
  before `supabase.auth.signOut()`. Not yet wired into any screen since auth/logout isn't
  built yet — call this out again when building screen-auth equivalent.
- **Abandoned tab / time limit:** a `pg_cron` job (`sweep-expired-demo-sessions`, every 15
  min) resets any guest whose `profiles.session_started_at` is older than 2 hours. That
  2-hour threshold is a placeholder — tell me if a live demo/sales call needs it shorter
  (e.g. 45–60 min) and I'll adjust the interval passed to `sweep_expired_demo_sessions()`
  in the cron schedule.
- **Manual full sweep:** `admin_reset_all_demo_sessions()` (RPC, platform-admin only) —
  useful to force a clean slate between scheduled demos without waiting on the cron job.
- Reset never touches template rows (`owner_profile_id`/`created_by_*` null) — only rows
  owned by or created under the specific guest profile being reset.

## Decided, not yet built

- Role picker screen (radio buttons + description per persona, "log out of role").
- Guided workflow tour (single-tab, notification-driven, auto persona-switch on "Next").
- White-label settings (company name + logo upload to the `org-logos` Storage bucket;
  display-only override, doesn't fork the underlying contract data).
- Contract Financial Dashboard screen: default view = all Task Orders/CLINs-SLINs/full
  date range; End Date drives cumulative KPI figures, Start Date only zooms the trend
  chart; burn trend chronological left-to-right, ascending dollars.
- PDF export of the dashboard — recommended server-side (re-run the same scoped/
  authorized query, render branded PDF) over client-side screenshot capture.
- ODC commitment add/close interface for customer_admin + platform admin.
- Scheduled purge of inactive persona clones (window not yet decided).
- Basic telemetry (`demo_events`) — capture points not yet wired into any screen.

## Explicitly parked

- Indirect rate monitoring (Fringe/Overhead/G&A cascade, standard vs. actual variance) —
  pending a meeting to get the real COA process detail. Not in this schema at all yet.
- EAC ("Projected at Completion") and Confidence-rating formula — proposed but not
  signed off: EAC = actual-to-date + (trailing burn rate × remaining months to
  `pop_end`) + open commitments.

## Source documents this was designed from

Real COA contract documents were used to derive the burndown/ODC model: a funding
modification (Mod 19), several monthly task-order invoices (VTTS/VTTL/MCC — labor by
employee/SLIN, current vs. cumulative), a funding projection workbook (the manual
"burndown estimation" this feature replaces), and a 2026 Indirect Rate Monitoring
workbook (parked, see above). None of those documents are in this repo — they live in
the Claude project's knowledge base if needed for reference.
