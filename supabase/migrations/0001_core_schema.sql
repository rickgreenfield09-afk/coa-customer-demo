-- =====================================================================
-- COA Customer Demo — core schema (Supabase-native)
--
-- Translated from the Gov-track COA Self Service Portal schema
-- (session-variable RLS, Azure Functions + Entra ID) into Supabase-
-- native RLS (auth.uid()/auth.jwt(), native Postgres RLS enforced by
-- PostgREST — no SET LOCAL session-variable wrapper needed here).
--
-- Scope: only what this demo needs — Contract Financial Dashboard
-- (burndown, CLIN/SLIN funding, ODC commitments) and the Travel
-- estimate/reimbursement workflow. Timekeeping/training/admin tables
-- from the Gov-track schema are intentionally NOT ported; time_entries
-- exists here only as the feed for burndown, not a full timekeeping UI.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------

-- One row per Supabase auth user. is_platform_admin is Ricky/sales —
-- can manage personas, invite guests, view telemetry across all guests.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  is_platform_admin boolean not null default false,
  display_company_name text,          -- white-label override, defaults to Axiom Forward if null
  display_logo_url text,
  active_persona_id uuid,             -- fk added below, after personas exists
  active_customer_id uuid,            -- which customer/company this guest is viewing as (customer-side personas)
  created_at timestamptz not null default now()
);

-- Auto-create a profile row on signup (invite or magic link).
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Personas / role picker
-- ---------------------------------------------------------------------

create table public.personas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_role text not null,          -- shown on the role-picker screen
  description text not null,           -- what this role can see/do (radio-button copy)
  category text not null check (category in ('employee', 'customer')),
  sort_order int not null default 0
);

alter table public.profiles
  add constraint profiles_active_persona_id_fkey
  foreign key (active_persona_id) references public.personas(id);

-- Employee-side personas (Employee, Supervisor, Travel Approver, etc.)
-- get an "assumed identity" via cloning: a template demo_employees row
-- (owner_profile_id null) holds 3-4 years of seeded history; on first
-- selection, cloning that row (and its time_entries/travel rows) gives
-- the guest their own copy, display name swapped to their own.
-- Customer-side personas (Customer Admin/Viewer) do NOT clone an
-- employee — they just view company-wide contract data scoped by
-- profiles.active_customer_id, so no row here for those.
create table public.demo_employees (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid references public.personas(id),
  owner_profile_id uuid references public.profiles(id) on delete cascade,  -- null = template
  template_source_id uuid references public.demo_employees(id),           -- which template this clone came from
  full_name text not null,
  job_title text,
  department text,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Customers / contracts / billing structure
-- (mirrors the Gov-track schema's customers/contracts/billing_nodes/
-- slins/slin_funding_history/labor_categories/employee_rates shape)
-- ---------------------------------------------------------------------

create table public.customers (
  customer_id uuid primary key default gen_random_uuid(),
  name text not null,
  is_default_demo_company boolean not null default false,  -- true only for the seeded "Axiom Forward Consulting" row
  created_at timestamptz not null default now()
);

create table public.customer_users (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(customer_id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'customer_viewer' check (role in ('customer_admin', 'customer_viewer')),
  created_at timestamptz not null default now(),
  unique (customer_id, profile_id)
);

create table public.contracts (
  contract_id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(customer_id),
  prime_contract_number text,
  delivery_order_number text,
  subcontract_number text,
  contract_type text not null check (contract_type in ('CPFF', 'COST', 'FFP', 'T&M')),
  fee_type text,
  fee_percentage numeric,
  line_item_label text not null default 'SLIN' check (line_item_label in ('CLIN', 'SLIN')),
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.billing_nodes (
  node_id uuid primary key default gen_random_uuid(),
  parent_node_id uuid references public.billing_nodes(node_id),
  customer_id uuid references public.customers(customer_id),
  contract_id uuid references public.contracts(contract_id),
  node_type text not null check (node_type in ('Customer', 'Contract', 'Task Order', 'SLIN', 'Indirect Pool')),
  code text,
  label text not null,
  is_leaf boolean not null default false,
  status text not null default 'active',
  sort_order int not null default 0,
  effective_start date,
  effective_end date,
  created_at timestamptz not null default now()
);

create table public.slins (
  slin_id uuid primary key default gen_random_uuid(),
  billing_node_id uuid not null unique references public.billing_nodes(node_id),
  contract_id uuid not null references public.contracts(contract_id),
  slin_code text not null,             -- 2 letters + 4 digits, e.g. "6100AC"
  slin_description text,
  slin_category text not null check (slin_category in ('Labor/Fee', 'ODC/Cost', 'Materials')),
  pop_start date,
  pop_end date,
  fee_percentage numeric,
  option_year text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.slin_funding_history (
  funding_id uuid primary key default gen_random_uuid(),
  slin_id uuid not null references public.slins(slin_id),
  mod_number text,
  mod_date date not null,
  previous_funding numeric not null,
  award_total numeric not null,
  cumulative_total numeric not null,   -- ceiling as of this mod — burndown reads the latest row per SLIN
  source_document text,
  created_at timestamptz not null default now()
);

create table public.labor_categories (
  labor_category_id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'active'
);

create table public.employee_rates (
  rate_id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.demo_employees(id),
  labor_category_id uuid not null references public.labor_categories(labor_category_id),
  slin_id uuid references public.slins(slin_id),
  bill_rate numeric,
  bill_rate_with_fee numeric,
  effective_start date not null,
  effective_end date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Time entries (burndown feed only — not a full timekeeping module)
-- ---------------------------------------------------------------------

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.demo_employees(id),
  slin_id uuid references public.slins(slin_id),
  work_date date not null,
  hours numeric not null check (hours > 0),
  status text not null default 'approved' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Travel
-- ---------------------------------------------------------------------

create table public.travel_estimates (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.demo_employees(id),
  slin_id uuid references public.slins(slin_id),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'expensed', 'paid')),
  destination_event text,
  leave_date date,
  return_date date,
  estimated_total_odc numeric,
  approved_by uuid references public.demo_employees(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.travel_expenses (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.travel_estimates(id),
  slin_id uuid references public.slins(slin_id),
  created_by uuid not null references public.demo_employees(id),
  current_status text not null default 'draft',
  supervisor_status text not null default 'pending',
  actual_total_odc numeric,
  supervisor_by uuid references public.demo_employees(id),
  supervisor_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ODC Commitments (non-travel obligations/procurement)
-- One row covers "commit then close" — open with an estimate, close
-- with the actual. A commitment can be created/closed by either a
-- platform-side demo_employee (COA-staff-equivalent) or a
-- customer_users row (the customer's own admin/POC) — exactly one of
-- each actor pair must be set.
-- ---------------------------------------------------------------------

create table public.odc_commitments (
  id uuid primary key default gen_random_uuid(),
  slin_id uuid not null references public.slins(slin_id),
  description text not null,
  reference_number text,
  committed_amount numeric not null check (committed_amount >= 0),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  expected_date date,
  actual_amount numeric,
  actual_date date,
  created_by_employee_id uuid references public.demo_employees(id),
  created_by_customer_user_id uuid references public.customer_users(id),
  closed_by_employee_id uuid references public.demo_employees(id),
  closed_by_customer_user_id uuid references public.customer_users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint odc_commitments_creator_exactly_one check (
    (num_nonnulls(created_by_employee_id, created_by_customer_user_id)) = 1
  )
);

-- ---------------------------------------------------------------------
-- Telemetry (sales visibility into demo usage)
-- ---------------------------------------------------------------------

create table public.demo_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  event_type text not null,           -- 'signup','role_selected','tour_step','report_viewed', etc.
  event_detail jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security
-- =====================================================================

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

create function public.owns_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.demo_employees
    where id = p_employee_id and owner_profile_id = auth.uid()
  );
$$;

create function public.is_customer_admin_for(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.customer_users
    where customer_id = p_customer_id and profile_id = auth.uid() and role = 'customer_admin'
  );
$$;

-- profiles: a guest sees/edits only their own row; platform admin sees all.
alter table public.profiles enable row level security;
create policy profiles_self_select on public.profiles for select using (id = auth.uid() or is_platform_admin());
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- personas: readable by anyone signed in (role-picker needs the full list).
alter table public.personas enable row level security;
create policy personas_read_all on public.personas for select using (auth.uid() is not null);

-- demo_employees: templates readable by anyone signed in; a clone only
-- by its owner (or platform admin).
alter table public.demo_employees enable row level security;
create policy demo_employees_select on public.demo_employees for select
  using (owner_profile_id is null or owner_profile_id = auth.uid() or is_platform_admin());
create policy demo_employees_insert_own_clone on public.demo_employees for insert
  with check (owner_profile_id = auth.uid() or is_platform_admin());
create policy demo_employees_update_own on public.demo_employees for update
  using (owner_profile_id = auth.uid() or is_platform_admin());

-- customers/contracts/billing_nodes/slins/slin_funding_history/
-- labor_categories: read-all for signed-in guests (this demo has one
-- shared contract dataset under Axiom Forward — no per-customer
-- isolation needed among demo guests themselves). Write: admin only.
alter table public.customers enable row level security;
create policy customers_read_all on public.customers for select using (auth.uid() is not null);
create policy customers_admin_write on public.customers for all using (is_platform_admin()) with check (is_platform_admin());

alter table public.contracts enable row level security;
create policy contracts_read_all on public.contracts for select using (auth.uid() is not null);
create policy contracts_admin_write on public.contracts for all using (is_platform_admin()) with check (is_platform_admin());

alter table public.billing_nodes enable row level security;
create policy billing_nodes_read_all on public.billing_nodes for select using (auth.uid() is not null);
create policy billing_nodes_admin_write on public.billing_nodes for all using (is_platform_admin()) with check (is_platform_admin());

alter table public.slins enable row level security;
create policy slins_read_all on public.slins for select using (auth.uid() is not null);
create policy slins_admin_write on public.slins for all using (is_platform_admin()) with check (is_platform_admin());

alter table public.slin_funding_history enable row level security;
create policy slin_funding_history_read_all on public.slin_funding_history for select using (auth.uid() is not null);
create policy slin_funding_history_admin_write on public.slin_funding_history for all using (is_platform_admin()) with check (is_platform_admin());

alter table public.labor_categories enable row level security;
create policy labor_categories_read_all on public.labor_categories for select using (auth.uid() is not null);
create policy labor_categories_admin_write on public.labor_categories for all using (is_platform_admin()) with check (is_platform_admin());

alter table public.employee_rates enable row level security;
create policy employee_rates_read_all on public.employee_rates for select using (auth.uid() is not null);
create policy employee_rates_admin_write on public.employee_rates for all using (is_platform_admin()) with check (is_platform_admin());

-- customer_users: a guest sees their own membership row(s); platform admin sees all.
alter table public.customer_users enable row level security;
create policy customer_users_select on public.customer_users for select
  using (profile_id = auth.uid() or is_platform_admin());
create policy customer_users_admin_write on public.customer_users for all
  using (is_platform_admin()) with check (is_platform_admin());

-- time_entries: a guest sees/writes only entries for demo_employees they own.
alter table public.time_entries enable row level security;
create policy time_entries_select on public.time_entries for select using (owns_employee(employee_id) or is_platform_admin());
create policy time_entries_write on public.time_entries for all
  using (owns_employee(employee_id) or is_platform_admin())
  with check (owns_employee(employee_id) or is_platform_admin());

-- travel_estimates / travel_expenses: same ownership pattern.
alter table public.travel_estimates enable row level security;
create policy travel_estimates_select on public.travel_estimates for select using (owns_employee(created_by) or is_platform_admin());
create policy travel_estimates_write on public.travel_estimates for all
  using (owns_employee(created_by) or is_platform_admin())
  with check (owns_employee(created_by) or is_platform_admin());

alter table public.travel_expenses enable row level security;
create policy travel_expenses_select on public.travel_expenses for select using (owns_employee(created_by) or is_platform_admin());
create policy travel_expenses_write on public.travel_expenses for all
  using (owns_employee(created_by) or is_platform_admin())
  with check (owns_employee(created_by) or is_platform_admin());

-- odc_commitments: read-all for signed-in guests (shared demo dataset);
-- write requires being the acting employee's owner, or a customer_admin
-- for the SLIN's customer, or platform admin.
alter table public.odc_commitments enable row level security;
create policy odc_commitments_read_all on public.odc_commitments for select using (auth.uid() is not null);
create policy odc_commitments_write on public.odc_commitments for all
  using (
    is_platform_admin()
    or (created_by_employee_id is not null and owns_employee(created_by_employee_id))
    or (created_by_customer_user_id is not null and exists (
      select 1 from public.customer_users cu
      join public.slins s on s.slin_id = odc_commitments.slin_id
      join public.billing_nodes bn on bn.node_id = s.billing_node_id
      where cu.profile_id = auth.uid() and cu.role = 'customer_admin' and cu.customer_id = bn.customer_id
    ))
  )
  with check (
    is_platform_admin()
    or (created_by_employee_id is not null and owns_employee(created_by_employee_id))
    or (created_by_customer_user_id is not null and exists (
      select 1 from public.customer_users cu
      join public.slins s on s.slin_id = odc_commitments.slin_id
      join public.billing_nodes bn on bn.node_id = s.billing_node_id
      where cu.profile_id = auth.uid() and cu.role = 'customer_admin' and cu.customer_id = bn.customer_id
    ))
  );

-- demo_events: a guest can insert their own events; only platform admin reads across all guests.
alter table public.demo_events enable row level security;
create policy demo_events_insert_own on public.demo_events for insert with check (profile_id = auth.uid() or is_platform_admin());
create policy demo_events_select_admin on public.demo_events for select using (profile_id = auth.uid() or is_platform_admin());

-- =====================================================================
-- NOTE: this is a starting point, not a final policy set. Known gaps
-- to close during the screens-build phase:
--   - "closed_by_*" write consistency on odc_commitments (who may
--     close vs. who may open) isn't split out yet — current policy
--     treats open/close/edit the same.
--   - Seed script will need to run as service role (bypasses RLS) to
--     populate template demo_employees/time_entries/travel history.
--   - Persona-clone creation (the "clone on first role selection"
--     function) should run as a Postgres function (security definer)
--     rather than raw client inserts, so a guest can't clone arbitrary
--     employee_id values.
-- =====================================================================
