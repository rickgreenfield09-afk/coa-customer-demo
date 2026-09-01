-- =====================================================================
-- Travel Estimate: separate event name from destination, split the
-- requested lodging cost from the GSA reference rate, and add the
-- 3-quotes-when-over-rate comparison workflow.
--
-- destination_event (existing column) keeps holding just the destination
-- going forward; event_name is new. per_diem_lodging_rate (existing)
-- becomes purely the GSA per diem ceiling (fetched via the new
-- gsa-per-diem edge function or entered manually) and is no longer used
-- in the cost calculation — lodging_cost_per_night (new) is the actual
-- requested/quoted nightly cost that feeds the total.
-- =====================================================================

alter table public.travel_estimates
  add column event_name text,
  add column lodging_cost_per_night numeric default 0;

create table public.travel_estimate_lodging_quotes (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.travel_estimates(id) on delete cascade,
  file_url text not null,
  file_name text,
  average_daily_rate numeric,
  uploaded_by uuid not null references public.demo_employees(id),
  uploaded_at timestamptz not null default now()
);

alter table public.travel_estimate_lodging_quotes enable row level security;
create policy travel_estimate_lodging_quotes_select on public.travel_estimate_lodging_quotes for select using (auth.uid() is not null);
create policy travel_estimate_lodging_quotes_write on public.travel_estimate_lodging_quotes for all
  using (is_platform_admin() or is_employee_side_actor())
  with check (is_platform_admin() or is_employee_side_actor());

-- ---------------------------------------------------------------------
-- Storage bucket for lodging comparison quotes (public bucket + public
-- object URLs, mirroring the travel-receipts bucket from 0009 — demo
-- data only, nothing sensitive). Folder convention: <estimate_id>/<filename>.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('travel-lodging-quotes', 'travel-lodging-quotes', true)
  on conflict (id) do nothing;

create policy travel_lodging_quotes_public_read on storage.objects for select
  using (bucket_id = 'travel-lodging-quotes');

create policy travel_lodging_quotes_employee_write on storage.objects for insert
  with check (bucket_id = 'travel-lodging-quotes' and (is_platform_admin() or is_employee_side_actor()));

create policy travel_lodging_quotes_employee_delete on storage.objects for delete
  using (bucket_id = 'travel-lodging-quotes' and (is_platform_admin() or is_employee_side_actor()));
