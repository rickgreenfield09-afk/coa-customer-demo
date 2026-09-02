-- =====================================================================
-- 1. Let an employee cancel their own travel estimate any time before it's
--    paid — a distinct terminal status from "denied" (someone else
--    rejected it) since this is the requester withdrawing it themselves.
-- 2. Lodging Cost becomes the TOTAL cost of the stay (room + taxes + fees
--    all-in, matching what a hotel actually quotes), not a per-night rate
--    multiplied out — per-night rates vary night to night, so multiplying
--    a single rate by nights didn't reflect reality. The separate Lodging
--    Fees/Taxes fields are now redundant (rolled into the one total) and
--    are dropped.
-- =====================================================================

alter table public.travel_estimates drop constraint travel_estimates_status_check;
alter table public.travel_estimates add constraint travel_estimates_status_check
  check (status in ('draft', 'submitted', 'supervisor_approved', 'approved', 'returned', 'denied', 'cancelled', 'expensed', 'paid'));

alter table public.travel_estimates rename column lodging_cost_per_night to lodging_cost_total;
alter table public.travel_estimates drop column lodging_fees;
alter table public.travel_estimates drop column lodging_taxes;
