-- =====================================================================
-- Contract metadata fields + contract_contacts table.
--
-- Structure lifted from a real Task Order Mod document (used only for
-- its field shape — SLIN coding convention, funding-mod format, POC
-- roles, DPAS/payment-terms fields; no real company names, contract
-- numbers, or contact info from that document appear anywhere in this
-- schema or the seed data that follows it). Mirrors the pilot portal's
-- contract_contacts pattern (screen-burndown.js bdContactRoles).
-- =====================================================================

alter table public.contracts
  add column issuing_organization text,     -- the fictional prime/customer awarding this contract
  add column dpas_priority_rating text,
  add column payment_terms text;

create table public.contract_contacts (
  contact_id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(contract_id) on delete cascade,
  contact_role text not null check (contact_role in ('Technical POC', 'Contractual POC', 'Security POC', 'Billing POC')),
  name text,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

alter table public.contract_contacts enable row level security;
create policy contract_contacts_read_all on public.contract_contacts for select using (auth.uid() is not null);
create policy contract_contacts_write on public.contract_contacts for all
  using (
    is_platform_admin()
    or exists (select 1 from public.contracts c where c.contract_id = contract_contacts.contract_id and is_customer_admin_for(c.customer_id))
  )
  with check (
    is_platform_admin()
    or exists (select 1 from public.contracts c where c.contract_id = contract_contacts.contract_id and is_customer_admin_for(c.customer_id))
  );
