-- =====================================================================
-- Split the Expense Report's combined "Rental Car / Gas / Parking /
-- Tolls" actual-cost field into the same 5 granular categories the
-- Estimate side already has (rental_car/fuel_gas/parking/tolls/
-- rideshare_estimate, split in migration 0012) — the Actual Costs
-- section needs one control per estimate line item for a true
-- side-by-side comparison, not one combined field standing in for 5
-- separate estimated amounts.
-- =====================================================================

alter table public.travel_expenses rename column actual_rental_car_gas_parking_tolls to actual_rental_car;
alter table public.travel_expenses
  add column actual_fuel_gas numeric default 0,
  add column actual_parking numeric default 0,
  add column actual_tolls numeric default 0,
  add column actual_rideshare numeric default 0;
