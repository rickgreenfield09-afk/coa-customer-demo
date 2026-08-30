-- =====================================================================
-- Customer Admin gets real financial write access.
--
-- 0001 only gave customer_admin write access to odc_commitments — every
-- other financial table (contracts, billing_nodes, slins,
-- slin_funding_history) was platform-admin-only. That didn't match the
-- intended role split: Customer Admin should be able to edit/interact
-- with all the contract financial data for their own company, Customer
-- Viewer stays strictly read-only (already true — no policy today gives
-- that role any write path).
-- =====================================================================

drop policy contracts_admin_write on public.contracts;
create policy contracts_write on public.contracts for all
  using (is_platform_admin() or is_customer_admin_for(customer_id))
  with check (is_platform_admin() or is_customer_admin_for(customer_id));

drop policy billing_nodes_admin_write on public.billing_nodes;
create policy billing_nodes_write on public.billing_nodes for all
  using (is_platform_admin() or (customer_id is not null and is_customer_admin_for(customer_id)))
  with check (is_platform_admin() or (customer_id is not null and is_customer_admin_for(customer_id)));

drop policy slins_admin_write on public.slins;
create policy slins_write on public.slins for all
  using (
    is_platform_admin()
    or exists (select 1 from public.contracts c where c.contract_id = slins.contract_id and is_customer_admin_for(c.customer_id))
  )
  with check (
    is_platform_admin()
    or exists (select 1 from public.contracts c where c.contract_id = slins.contract_id and is_customer_admin_for(c.customer_id))
  );

drop policy slin_funding_history_admin_write on public.slin_funding_history;
create policy slin_funding_history_write on public.slin_funding_history for all
  using (
    is_platform_admin()
    or exists (
      select 1 from public.slins s join public.contracts c on c.contract_id = s.contract_id
      where s.slin_id = slin_funding_history.slin_id and is_customer_admin_for(c.customer_id)
    )
  )
  with check (
    is_platform_admin()
    or exists (
      select 1 from public.slins s join public.contracts c on c.contract_id = s.contract_id
      where s.slin_id = slin_funding_history.slin_id and is_customer_admin_for(c.customer_id)
    )
  );

update public.personas set description =
  'Full read/write access to the Contract Financial Dashboard for Axiom Forward Consulting — edit contracts, SLINs, and funding mods, and open/close ODC commitments.'
  where slug = 'customer_admin';

update public.personas set description =
  'Read-only access to the Contract Financial Dashboard for Axiom Forward Consulting — view contracts, SLINs, funding, and ODC commitments, no edits.'
  where slug = 'customer_viewer';
