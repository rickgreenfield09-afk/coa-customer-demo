-- =====================================================================
-- Persist the "billable to Prime" totals (internal cost * fee multiplier,
-- excluding per-diem meals/EWW) computed in teCalc(), so the Supervisor's
-- approval view can show them without re-deriving the math from a partial
-- set of stored line items. Fee-multiplier/Prime-billable info is only
-- shown on the Supervisor approval view, not the Employee's own form.
-- =====================================================================

alter table public.travel_estimates
  add column billable_trip_lead_total numeric default 0,
  add column billable_grand_total numeric default 0;
