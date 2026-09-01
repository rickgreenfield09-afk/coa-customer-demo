-- =====================================================================
-- Travel Estimate: structured city/state (feeds the GSA lookup directly
-- instead of parsing a free-text "City, ST" field), lodging fees/taxes,
-- and splitting the old combined "Rental Car / Gas / Parking / Tolls"
-- field into its real parts plus a new rideshare estimate.
--
-- destination_event is untouched and keeps holding the combined "City, ST"
-- display string, now derived from city/state on save rather than typed
-- directly — every existing display call site that reads destination_event
-- keeps working unchanged.
-- =====================================================================

alter table public.travel_estimates
  add column city text,
  add column state text,
  add column lodging_fees numeric default 0,
  add column lodging_taxes numeric default 0,
  add column fuel_gas numeric default 0,
  add column parking numeric default 0,
  add column tolls numeric default 0,
  add column rideshare_estimate numeric default 0;

alter table public.travel_estimates rename column rental_car_gas_parking_tolls to rental_car;
