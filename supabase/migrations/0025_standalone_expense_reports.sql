-- =====================================================================
-- Expense reports that are not tied to a travel request.
--
-- A standalone report has no estimate to compare against, so it carries its
-- own event/purpose, destination and contract. It still gets a tracking
-- number the same way a travel request does: "<SLIN code>-<5 digits>" from
-- assign_tracking_number() (0024), issued once at the report's first
-- Supervisor approval, when the approver picks Contract / Task Order / SLIN.
-- (slin_id already exists on travel_expenses; the dashboard's ODC burn counts
-- it once the approval sets it.)
-- =====================================================================

alter table public.travel_expenses alter column estimate_id drop not null;

alter table public.travel_expenses
  add column event_name text,
  add column destination_event text,
  add column contract_id uuid references public.contracts(contract_id),
  add column task_order_node_id uuid references public.billing_nodes(node_id),
  add column tracking_number text unique;
