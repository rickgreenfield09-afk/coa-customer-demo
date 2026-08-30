-- =====================================================================
-- Contract Financial Dashboard needs cross-employee visibility into
-- time_entries/travel_estimates/travel_expenses to compute burn — the
-- owner-only SELECT policies from 0001 (appropriate for a timekeeping
-- UI) left Customer Admin/Viewer with zero visibility into any of it,
-- since those personas own no demo_employees at all. Writes stay scoped
-- to the owner (or platform admin) — only SELECT is widened, matching
-- the same read-all-for-signed-in-guests pattern already used for
-- customers/contracts/slins/slin_funding_history/odc_commitments.
-- =====================================================================

drop policy time_entries_select on public.time_entries;
create policy time_entries_select_all on public.time_entries for select using (auth.uid() is not null);

drop policy travel_estimates_select on public.travel_estimates;
create policy travel_estimates_select_all on public.travel_estimates for select using (auth.uid() is not null);

drop policy travel_expenses_select on public.travel_expenses;
create policy travel_expenses_select_all on public.travel_expenses for select using (auth.uid() is not null);
