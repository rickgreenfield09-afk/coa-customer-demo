-- =====================================================================
-- Travel module expansion — full per-diem/EWW/fee-multiplier calculator,
-- ported from the COA Employee Portal's screen-travel-estimate.js /
-- screen-travel-expense.js (structure and formulas only — no real company
-- data). Adapted workflow, confirmed with user 2026-08-31:
--
--   Travel Estimate:  draft -> submitted -> supervisor_approved -> approved
--                      (approved = Prime/Customer Admin has authorized travel)
--                      -> expensed -> paid
--                      (returned / denied are terminal, from either stage)
--
--   Travel Expense:   draft -> submitted -> approved (single-stage,
--                      Supervisor only — the Prime/Customer Admin has no
--                      role in reimbursement, only in travel authorization)
--                      -> returned / denied
--
-- The three approval actors map onto EXISTING personas — no new persona:
--   Employee     — creates/submits estimates and expense reports
--   Supervisor   — approves/returns/denies both (internal, first stage)
--   Customer Admin — final travel *authorization* only (estimates), acting
--                    for the Prime/contract customer. Never touches expenses.
-- =====================================================================

-- ---------------------------------------------------------------------
-- travel_estimates: full calculator fields + expanded status lifecycle
-- ---------------------------------------------------------------------

alter table public.travel_estimates
  add column number_of_trainers int not null default 1,
  add column per_diem_lodging_rate numeric default 0,
  add column per_diem_meals_rate numeric default 0,
  add column airfare_avg numeric default 0,
  add column airport_parking_transport numeric default 0,
  add column baggage numeric default 0,
  add column rental_car_gas_parking_tolls numeric default 0,
  add column mileage numeric default 0,
  add column shipping_to numeric default 0,
  add column shipping_back numeric default 0,
  add column eww_rate numeric default 0,
  add column eww_hours_per_trainer numeric default 0,
  add column per_traveler_subtotal numeric default 0,
  add column trip_lead_total numeric default 0,
  add column eww_total numeric default 0,
  add column fee_multiplier_used numeric,
  -- approved_by/approved_at (from 0001) are repurposed as the SUPERVISOR
  -- stage's decision. These two are the separate final PRIME/Customer Admin
  -- authorization stage.
  add column prime_approved_by_customer_user_id uuid references public.customer_users(id),
  add column prime_approved_at timestamptz;

alter table public.travel_estimates drop constraint travel_estimates_status_check;
alter table public.travel_estimates add constraint travel_estimates_status_check
  check (status in ('draft', 'submitted', 'supervisor_approved', 'approved', 'returned', 'denied', 'expensed', 'paid'));

create table public.travel_estimate_audit_log (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.travel_estimates(id) on delete cascade,
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now(),
  action text not null,
  field_changes jsonb,
  previous_status text,
  new_status text
);

create table public.travel_settings (
  id uuid primary key default gen_random_uuid(),
  fee_multiplier numeric not null default 1.10
);
insert into public.travel_settings (fee_multiplier) values (1.10);

-- ---------------------------------------------------------------------
-- travel_expenses: full calculator fields (actuals) — single-stage
-- approval already matches 0001's shape (current_status/supervisor_status,
-- no principal stage), so no status-column changes needed there.
-- ---------------------------------------------------------------------

alter table public.travel_expenses
  add column number_of_trainers int not null default 1,
  add column actual_leave_date date,
  add column actual_return_date date,
  add column actual_airfare numeric default 0,
  add column actual_airport_parking_transport numeric default 0,
  add column actual_baggage numeric default 0,
  add column actual_lodging_total numeric default 0,
  add column actual_rental_car_gas_parking_tolls numeric default 0,
  add column actual_mileage numeric default 0,
  add column actual_shipping_to numeric default 0,
  add column actual_shipping_back numeric default 0,
  add column per_diem_meals_rate numeric default 0,
  add column eww_rate numeric default 0,
  add column eww_hours_per_trainer numeric default 0,
  add column actual_per_diem_meals_total numeric default 0,
  add column actual_per_traveler_subtotal numeric default 0,
  add column actual_trip_lead_total numeric default 0,
  add column actual_eww_total numeric default 0,
  add column variance_total numeric default 0;

create table public.travel_expense_audit_log (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.travel_expenses(id) on delete cascade,
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now(),
  action text not null,
  field_changes jsonb,
  previous_status text,
  new_status text
);

create table public.travel_expense_receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.travel_expenses(id) on delete cascade,
  file_url text not null,
  file_name text,
  uploaded_by uuid not null references public.demo_employees(id),
  uploaded_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS updates
--
-- Write access on travel_estimates/travel_expenses widens from
-- "owns_employee(created_by)" (0001 — appropriate for a timekeeping-style
-- self-service form) to "any employee-side guest" so a Supervisor persona
-- can act on an Employee's submission — this is a deliberate simplification
-- for a small single-company demo, not a real-world approval boundary
-- (matches the coarse-trust precedent already accepted on odc_commitments).
-- ---------------------------------------------------------------------

create function public.is_employee_side_actor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.demo_employees where owner_profile_id = auth.uid());
$$;

drop policy travel_estimates_write on public.travel_estimates;
create policy travel_estimates_write on public.travel_estimates for all
  using (
    is_platform_admin()
    or is_employee_side_actor()
    or exists (
      select 1 from public.customer_users cu
      join public.slins s on s.slin_id = travel_estimates.slin_id
      join public.contracts c on c.contract_id = s.contract_id
      where cu.profile_id = auth.uid() and cu.role = 'customer_admin' and cu.customer_id = c.customer_id
    )
  )
  with check (
    is_platform_admin()
    or is_employee_side_actor()
    or exists (
      select 1 from public.customer_users cu
      join public.slins s on s.slin_id = travel_estimates.slin_id
      join public.contracts c on c.contract_id = s.contract_id
      where cu.profile_id = auth.uid() and cu.role = 'customer_admin' and cu.customer_id = c.customer_id
    )
  );

drop policy travel_expenses_write on public.travel_expenses;
create policy travel_expenses_write on public.travel_expenses for all
  using (is_platform_admin() or is_employee_side_actor())
  with check (is_platform_admin() or is_employee_side_actor());

alter table public.travel_estimate_audit_log enable row level security;
create policy travel_estimate_audit_log_select on public.travel_estimate_audit_log for select using (auth.uid() is not null);
create policy travel_estimate_audit_log_insert on public.travel_estimate_audit_log for insert with check (changed_by = auth.uid());

alter table public.travel_expense_audit_log enable row level security;
create policy travel_expense_audit_log_select on public.travel_expense_audit_log for select using (auth.uid() is not null);
create policy travel_expense_audit_log_insert on public.travel_expense_audit_log for insert with check (changed_by = auth.uid());

alter table public.travel_settings enable row level security;
create policy travel_settings_select on public.travel_settings for select using (auth.uid() is not null);
create policy travel_settings_write on public.travel_settings for all using (is_platform_admin()) with check (is_platform_admin());

alter table public.travel_expense_receipts enable row level security;
create policy travel_expense_receipts_select on public.travel_expense_receipts for select using (auth.uid() is not null);
create policy travel_expense_receipts_write on public.travel_expense_receipts for all
  using (is_platform_admin() or is_employee_side_actor())
  with check (is_platform_admin() or is_employee_side_actor());

-- ---------------------------------------------------------------------
-- Storage bucket for receipts (public bucket + public object URLs,
-- mirroring the pilot portal's pattern — demo data only, nothing
-- sensitive). Folder convention: <expense_id>/<filename>.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('travel-receipts', 'travel-receipts', true)
  on conflict (id) do nothing;

create policy travel_receipts_public_read on storage.objects for select
  using (bucket_id = 'travel-receipts');

create policy travel_receipts_employee_write on storage.objects for insert
  with check (bucket_id = 'travel-receipts' and (is_platform_admin() or is_employee_side_actor()));

create policy travel_receipts_employee_delete on storage.objects for delete
  using (bucket_id = 'travel-receipts' and (is_platform_admin() or is_employee_side_actor()));
