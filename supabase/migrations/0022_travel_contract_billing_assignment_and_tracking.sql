-- =====================================================================
-- 1. Travel estimates now capture the employee's chosen CONTRACT at
--    submission time (employees know their contract, not which SLIN to
--    bill) — the Supervisor assigns the specific Task Order + SLIN at
--    approval time via a cascading Contract -> Task Order -> SLIN picker,
--    since employees don't know SLIN codes.
-- 2. A tracking number is generated at Supervisor-approval time so the
--    Prime, and every later screen for this trip (authorization, expense
--    report), can reference the same identifier.
-- 3. Lodging now captures a separate Room Cost, since GSA's per-diem
--    lodging ceiling applies to the room rate only — taxes and fees
--    don't count against it.
-- =====================================================================

alter table public.travel_estimates
  add column contract_id uuid references public.contracts(contract_id),
  add column task_order_node_id uuid references public.billing_nodes(node_id),
  add column tracking_number text unique,
  add column lodging_room_cost numeric default 0;
