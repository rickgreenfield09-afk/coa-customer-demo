-- =====================================================================
-- Contract Data (ported Burndown admin screens) + ODC Procurements access.
--
-- Gates the new Contract Data screen (Customers & Contracts / Billing
-- Tree / SLIN Table / Rates, ported from COA-pilot-portal's
-- screen-burndown.js) and the new ODC Procurements screen to the
-- Supervisor and Customer Admin personas — not platform-admin-only like
-- the source app, since this demo hosts live sales walkthroughs and
-- Supervisor/Customer Admin are the personas playing "COA staff" /
-- "the customer" respectively.
--
-- Also adds three atomic RPCs (bd_add_contract / bd_bulk_add_slins /
-- bd_add_customer_with_contract) ported from COA-pilot-portal's
-- add-burndown-atomic-rpcs.sql, rewritten against this app's actual
-- columns — the pilot portal's contracts/billing_nodes/slins/
-- slin_funding_history/customers tables carry several columns
-- (created_by, billable, entered_by_admin_id, customer_type, cage_code,
-- uei, address, slins.contract_type) that don't exist in this schema;
-- those fields are simply not referenced here.
-- =====================================================================

create function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.demo_employees de
    join public.personas p on p.id = de.persona_id
    where de.owner_profile_id = auth.uid() and p.slug = 'supervisor'
  );
$$;

-- ---------------------------------------------------------------------
-- Extend existing financial write policies to also allow Supervisor.
-- (contracts/billing_nodes/slins/slin_funding_history already allow
-- is_customer_admin_for(...) from 0004 — just OR in is_supervisor().)
-- ---------------------------------------------------------------------

drop policy contracts_write on public.contracts;
create policy contracts_write on public.contracts for all
  using (is_platform_admin() or is_supervisor() or is_customer_admin_for(customer_id))
  with check (is_platform_admin() or is_supervisor() or is_customer_admin_for(customer_id));

drop policy billing_nodes_write on public.billing_nodes;
create policy billing_nodes_write on public.billing_nodes for all
  using (is_platform_admin() or is_supervisor() or (customer_id is not null and is_customer_admin_for(customer_id)))
  with check (is_platform_admin() or is_supervisor() or (customer_id is not null and is_customer_admin_for(customer_id)));

drop policy slins_write on public.slins;
create policy slins_write on public.slins for all
  using (
    is_platform_admin() or is_supervisor()
    or exists (select 1 from public.contracts c where c.contract_id = slins.contract_id and is_customer_admin_for(c.customer_id))
  )
  with check (
    is_platform_admin() or is_supervisor()
    or exists (select 1 from public.contracts c where c.contract_id = slins.contract_id and is_customer_admin_for(c.customer_id))
  );

drop policy slin_funding_history_write on public.slin_funding_history;
create policy slin_funding_history_write on public.slin_funding_history for all
  using (
    is_platform_admin() or is_supervisor()
    or exists (
      select 1 from public.slins s join public.contracts c on c.contract_id = s.contract_id
      where s.slin_id = slin_funding_history.slin_id and is_customer_admin_for(c.customer_id)
    )
  )
  with check (
    is_platform_admin() or is_supervisor()
    or exists (
      select 1 from public.slins s join public.contracts c on c.contract_id = s.contract_id
      where s.slin_id = slin_funding_history.slin_id and is_customer_admin_for(c.customer_id)
    )
  );

drop policy contract_contacts_write on public.contract_contacts;
create policy contract_contacts_write on public.contract_contacts for all
  using (
    is_platform_admin() or is_supervisor()
    or exists (select 1 from public.contracts c where c.contract_id = contract_contacts.contract_id and is_customer_admin_for(c.customer_id))
  )
  with check (
    is_platform_admin() or is_supervisor()
    or exists (select 1 from public.contracts c where c.contract_id = contract_contacts.contract_id and is_customer_admin_for(c.customer_id))
  );

-- ---------------------------------------------------------------------
-- Tables that were platform-admin-only in 0001 — the Customers &
-- Contracts subtab and Rates subtab need Supervisor/Customer Admin
-- write access too.
--
-- customers: a Customer Admin may write their own company's row (scoped
-- by is_customer_admin_for on the row's own customer_id); Supervisor
-- (COA-internal) may write any row, matching how they can create new
-- customers via the "Add Customer" flow before any customer_users
-- membership exists.
-- ---------------------------------------------------------------------

drop policy customers_admin_write on public.customers;
create policy customers_write on public.customers for all
  using (is_platform_admin() or is_supervisor() or is_customer_admin_for(customer_id))
  with check (is_platform_admin() or is_supervisor() or is_customer_admin_for(customer_id));

drop policy customer_users_admin_write on public.customer_users;
create policy customer_users_write on public.customer_users for all
  using (is_platform_admin() or is_supervisor() or is_customer_admin_for(customer_id))
  with check (is_platform_admin() or is_supervisor() or is_customer_admin_for(customer_id));

drop policy labor_categories_admin_write on public.labor_categories;
create policy labor_categories_write on public.labor_categories for all
  using (is_platform_admin() or is_supervisor())
  with check (is_platform_admin() or is_supervisor());

drop policy employee_rates_admin_write on public.employee_rates;
create policy employee_rates_write on public.employee_rates for all
  using (is_platform_admin() or is_supervisor() or is_customer_admin_for(
    (select c.customer_id from public.slins s join public.contracts c on c.contract_id = s.contract_id where s.slin_id = employee_rates.slin_id)
  ))
  with check (is_platform_admin() or is_supervisor() or is_customer_admin_for(
    (select c.customer_id from public.slins s join public.contracts c on c.contract_id = s.contract_id where s.slin_id = employee_rates.slin_id)
  ));

-- ---------------------------------------------------------------------
-- odc_commitments: tighten the employee-side write clause from
-- owns_employee(...) (any employee-side persona — Employee or
-- Supervisor) to is_supervisor() specifically, per the access decision
-- above. The 0001 file's own trailing comment flagged this open/close
-- write-consistency gap as unfinished — this closes it.
-- ---------------------------------------------------------------------

drop policy odc_commitments_write on public.odc_commitments;
create policy odc_commitments_write on public.odc_commitments for all
  using (
    is_platform_admin()
    or (created_by_employee_id is not null and is_supervisor() and owns_employee(created_by_employee_id))
    or (created_by_customer_user_id is not null and exists (
      select 1 from public.customer_users cu
      join public.slins s on s.slin_id = odc_commitments.slin_id
      join public.billing_nodes bn on bn.node_id = s.billing_node_id
      where cu.profile_id = auth.uid() and cu.role = 'customer_admin' and cu.customer_id = bn.customer_id
    ))
  )
  with check (
    is_platform_admin()
    or (created_by_employee_id is not null and is_supervisor() and owns_employee(created_by_employee_id))
    or (created_by_customer_user_id is not null and exists (
      select 1 from public.customer_users cu
      join public.slins s on s.slin_id = odc_commitments.slin_id
      join public.billing_nodes bn on bn.node_id = s.billing_node_id
      where cu.profile_id = auth.uid() and cu.role = 'customer_admin' and cu.customer_id = bn.customer_id
    ))
  );

-- =====================================================================
-- Atomic RPCs for the ported Burndown screens (Add Customer [+contract],
-- Add Contract, bulk SLIN entry). SECURITY INVOKER (default) — RLS
-- above is still enforced per-insert inside the transaction, so a
-- non-Supervisor/non-Customer-Admin caller still gets blocked, and any
-- failure partway through rolls back the whole call.
-- =====================================================================

create or replace function public.bd_add_contract(payload jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_contract_id uuid := gen_random_uuid();
  contact jsonb;
begin
  insert into public.contracts(
    contract_id, customer_id, prime_contract_number, delivery_order_number,
    subcontract_number, contract_type, fee_type, fee_percentage,
    line_item_label, issuing_organization, dpas_priority_rating, payment_terms, status
  ) values (
    new_contract_id,
    (payload->>'customer_id')::uuid,
    nullif(payload->>'prime_contract_number', ''),
    nullif(payload->>'delivery_order_number', ''),
    nullif(payload->>'subcontract_number', ''),
    payload->>'contract_type',
    nullif(payload->>'fee_type', ''),
    nullif(payload->>'fee_percentage', '')::numeric,
    coalesce(nullif(payload->>'line_item_label', ''), 'SLIN'),
    nullif(payload->>'issuing_organization', ''),
    nullif(payload->>'dpas_priority_rating', ''),
    nullif(payload->>'payment_terms', ''),
    'active'
  );

  for contact in select * from jsonb_array_elements(coalesce(payload->'contacts', '[]'::jsonb))
  loop
    insert into public.contract_contacts(
      contact_id, contract_id, contact_role, name, email, phone
    ) values (
      gen_random_uuid(), new_contract_id,
      contact->>'role', contact->>'name',
      nullif(contact->>'email', ''), nullif(contact->>'phone', '')
    );
  end loop;

  return new_contract_id;
end;
$$;

grant execute on function public.bd_add_contract(jsonb) to authenticated;

create or replace function public.bd_bulk_add_slins(payload jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  row_data jsonb;
  new_node_id uuid;
  new_slin_id uuid;
  v_contract_id uuid := (payload->>'contract_id')::uuid;
  v_customer_id uuid := nullif(payload->>'customer_id', '')::uuid;
  v_parent_node_id uuid := nullif(payload->>'parent_node_id', '')::uuid;
  v_mod_number text := nullif(payload->>'mod_number', '');
  v_mod_date date := coalesce(nullif(payload->>'mod_date', '')::date, current_date);
  v_source_document text := nullif(payload->>'source_document', '');
  v_prev numeric;
  v_award numeric;
  idx int := 0;
begin
  for row_data in select * from jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb))
  loop
    if coalesce(row_data->>'slin_code', '') = '' then
      continue;
    end if;

    new_node_id := gen_random_uuid();
    insert into public.billing_nodes(
      node_id, parent_node_id, customer_id, contract_id, node_type, code, label,
      is_leaf, status, sort_order
    ) values (
      new_node_id, v_parent_node_id, v_customer_id, v_contract_id, 'SLIN',
      row_data->>'slin_code',
      row_data->>'slin_code' || coalesce(' — ' || nullif(row_data->>'slin_desc', ''), ''),
      true, 'active', idx
    );

    new_slin_id := gen_random_uuid();
    insert into public.slins(
      slin_id, billing_node_id, contract_id, slin_code, slin_description,
      slin_category, option_year, pop_start, pop_end, fee_percentage, status
    ) values (
      new_slin_id, new_node_id, v_contract_id,
      row_data->>'slin_code',
      nullif(row_data->>'slin_desc', ''),
      row_data->>'category',
      nullif(row_data->>'option_year', ''),
      nullif(row_data->>'pop_start', '')::date,
      nullif(row_data->>'pop_end', '')::date,
      nullif(row_data->>'fee_percentage', '')::numeric,
      'active'
    );

    if coalesce(row_data->>'award_total', '') <> '' then
      v_prev := coalesce(nullif(row_data->>'prev_funding', '')::numeric, 0);
      v_award := (row_data->>'award_total')::numeric;
      insert into public.slin_funding_history(
        funding_id, slin_id, mod_number, mod_date, previous_funding,
        award_total, cumulative_total, source_document
      ) values (
        gen_random_uuid(), new_slin_id, v_mod_number, v_mod_date, v_prev,
        v_award,
        coalesce(nullif(row_data->>'cum_total', '')::numeric, v_prev + v_award),
        v_source_document
      );
    end if;

    idx := idx + 1;
  end loop;
end;
$$;

grant execute on function public.bd_bulk_add_slins(jsonb) to authenticated;

create or replace function public.bd_add_customer_with_contract(payload jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_customer_id uuid := gen_random_uuid();
  new_contract_id uuid;
  contract_payload jsonb := payload->'contract';
  bulk_payload jsonb := payload->'bulk';
begin
  insert into public.customers(customer_id, name, is_default_demo_company)
  values (new_customer_id, payload->>'name', false);

  if contract_payload is not null then
    new_contract_id := public.bd_add_contract(
      contract_payload || jsonb_build_object('customer_id', new_customer_id)
    );

    if bulk_payload is not null then
      perform public.bd_bulk_add_slins(
        bulk_payload || jsonb_build_object(
          'contract_id', new_contract_id,
          'customer_id', new_customer_id,
          'parent_node_id', null
        )
      );
    end if;
  end if;

  return new_customer_id;
end;
$$;

grant execute on function public.bd_add_customer_with_contract(jsonb) to authenticated;
