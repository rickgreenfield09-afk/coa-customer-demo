-- =====================================================================
-- Travel Estimate: up to 4 travelers per request, each linked to a real
-- demo_employees record, with their own EWW rate/hours — matches how the
-- real CyberOffset Travel Estimate spreadsheet computes EWW per traveler
-- ((rate1*hours1)+(rate2*hours2)+(rate3*hours3)+(rate4*hours4)) rather
-- than one shared rate/hours times headcount.
--
-- travel_estimates.number_of_trainers is now derived from COUNT(*) of
-- rows here rather than free-typed. travel_estimates.eww_rate/
-- eww_hours_per_trainer (existing columns) are kept as-is — the Travel
-- Expense side still reads a single rate/hours pair when prefilling from
-- an approved estimate (the real expense-report spreadsheet has no
-- per-traveler EWW at all), so the Estimate form writes the AVERAGE
-- rate/hours across travelers into those two legacy columns on submit,
-- purely so existing Expense-side prefill logic keeps working.
-- =====================================================================

create table public.travel_estimate_travelers (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.travel_estimates(id) on delete cascade,
  employee_id uuid not null references public.demo_employees(id),
  traveler_number int not null check (traveler_number between 1 and 4),
  eww_rate numeric default 0,
  eww_hours numeric default 0,
  created_at timestamptz not null default now(),
  unique (estimate_id, traveler_number)
);

alter table public.travel_estimate_travelers enable row level security;
create policy travel_estimate_travelers_select on public.travel_estimate_travelers for select using (auth.uid() is not null);
create policy travel_estimate_travelers_write on public.travel_estimate_travelers for all
  using (is_platform_admin() or is_employee_side_actor())
  with check (is_platform_admin() or is_employee_side_actor());
