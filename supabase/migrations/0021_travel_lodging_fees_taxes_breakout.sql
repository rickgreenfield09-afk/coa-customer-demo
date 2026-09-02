-- =====================================================================
-- Restore separate Lodging Fees / Lodging Taxes fields alongside the
-- all-in Lodging Cost total added in migration 0020. The total (room +
-- fees + taxes) is still what drives every cost calculation and the GSA
-- comparison — fees and taxes are NOT added on top of it, they're already
-- included — but they need their own controls because some government
-- contracts handle certain fees/taxes differently (e.g. reimbursed or
-- excluded), so approvers need to see the breakdown, not just the total.
-- =====================================================================

alter table public.travel_estimates
  add column lodging_fees numeric default 0,
  add column lodging_taxes numeric default 0;
