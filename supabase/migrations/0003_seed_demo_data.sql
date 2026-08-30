-- =====================================================================
-- Seed data — Axiom Forward Consulting, ~3.5 years of contract/financial/
-- travel history for the customer demo. Run once via the SQL Editor
-- (executes as the postgres role, which bypasses RLS — no service role
-- key needed). Re-running this file will duplicate every row; if you
-- need to re-seed, delete the customer row first (cascades are not set
-- up for admin tables, so see the teardown note at the bottom).
--
-- Everything created here is TEMPLATE data: demo_employees rows have
-- owner_profile_id = null, so they're never touched by the reset
-- lifecycle in 0002_persona_lifecycle.sql — guests clone off these, the
-- originals stay put.
-- =====================================================================

do $$
declare
  v_customer_id        uuid := '00000000-0000-0000-0000-0000000000c1';
  v_contract_id         uuid := '00000000-0000-0000-0000-0000000000c2';
  v_node_customer        uuid := '00000000-0000-0000-0000-0000000000b1';
  v_node_contract         uuid := '00000000-0000-0000-0000-0000000000b2';
  v_node_taskorder         uuid := '00000000-0000-0000-0000-0000000000b3';
  v_node_slin_base          uuid := '00000000-0000-0000-0000-0000000000b4';
  v_node_slin_oy1            uuid := '00000000-0000-0000-0000-0000000000b5';
  v_node_slin_oy2             uuid := '00000000-0000-0000-0000-0000000000b6';
  v_node_slin_oy3              uuid := '00000000-0000-0000-0000-0000000000b7';
  v_node_slin_odc                uuid := '00000000-0000-0000-0000-0000000000b8';

  v_slin_base       uuid := '00000000-0000-0000-0000-0000000000a1';
  v_slin_oy1        uuid := '00000000-0000-0000-0000-0000000000a2';
  v_slin_oy2        uuid := '00000000-0000-0000-0000-0000000000a3';
  v_slin_oy3        uuid := '00000000-0000-0000-0000-0000000000a4';
  v_slin_odc        uuid := '00000000-0000-0000-0000-0000000000a5';

  v_persona_employee    uuid := '00000000-0000-0000-0000-00000000e001';
  v_persona_supervisor   uuid := '00000000-0000-0000-0000-00000000e002';
  v_persona_cust_admin     uuid := '00000000-0000-0000-0000-00000000e003';
  v_persona_cust_viewer     uuid := '00000000-0000-0000-0000-00000000e004';

  v_lc_analyst      uuid := '00000000-0000-0000-0000-0000000000d1';
  v_lc_pm           uuid := '00000000-0000-0000-0000-0000000000d2';

  v_emp_analyst     uuid := '00000000-0000-0000-0000-0000000000f1';
  v_emp_pm          uuid := '00000000-0000-0000-0000-0000000000f2';

  v_start_date      date := current_date - interval '3 years 6 months';
  v_oy1_start       date := current_date - interval '2 years 6 months';
  v_oy2_start       date := current_date - interval '1 years 6 months';
  v_oy3_start       date := current_date - interval '6 months';
  v_oy3_end         date := current_date + interval '6 months';
begin

  -- ---------------- Customer / Contract / Billing tree ----------------
  insert into public.customers (customer_id, name, is_default_demo_company)
    values (v_customer_id, 'Axiom Forward Consulting', true);

  insert into public.contracts (contract_id, customer_id, prime_contract_number, delivery_order_number, contract_type, fee_type, fee_percentage, line_item_label, status)
    values (v_contract_id, v_customer_id, 'GS-00F-0231CA', 'DO-0007', 'CPFF', 'Fixed Fee', 8, 'SLIN', 'active');

  insert into public.billing_nodes (node_id, parent_node_id, customer_id, contract_id, node_type, label, is_leaf, sort_order, effective_start)
  values
    (v_node_customer, null, v_customer_id, null, 'Customer', 'Axiom Forward Consulting', false, 1, v_start_date),
    (v_node_contract, v_node_customer, v_customer_id, v_contract_id, 'Contract', 'GS-00F-0231CA / DO-0007', false, 1, v_start_date),
    (v_node_taskorder, v_node_contract, v_customer_id, v_contract_id, 'Task Order', 'Task Order 0001', false, 1, v_start_date),
    (v_node_slin_base, v_node_taskorder, v_customer_id, v_contract_id, 'SLIN', '6100AA — Labor/Fee (Base Year)', true, 1, v_start_date),
    (v_node_slin_oy1, v_node_taskorder, v_customer_id, v_contract_id, 'SLIN', '6100AB — Labor/Fee (Option Year 1)', true, 2, v_oy1_start),
    (v_node_slin_oy2, v_node_taskorder, v_customer_id, v_contract_id, 'SLIN', '6100AC — Labor/Fee (Option Year 2)', true, 3, v_oy2_start),
    (v_node_slin_oy3, v_node_taskorder, v_customer_id, v_contract_id, 'SLIN', '6100AD — Labor/Fee (Option Year 3)', true, 4, v_oy3_start),
    (v_node_slin_odc, v_node_taskorder, v_customer_id, v_contract_id, 'SLIN', '6100AE — ODC/Cost (Base thru Option Year 3)', true, 5, v_start_date);

  insert into public.slins (slin_id, billing_node_id, contract_id, slin_code, slin_description, slin_category, pop_start, pop_end, fee_percentage, option_year, status)
  values
    (v_slin_base, v_node_slin_base, v_contract_id, '6100AA', 'Base Year Labor/Fee', 'Labor/Fee', v_start_date, v_oy1_start, 8, 'Base', 'closed'),
    (v_slin_oy1, v_node_slin_oy1, v_contract_id, '6100AB', 'Option Year 1 Labor/Fee', 'Labor/Fee', v_oy1_start, v_oy2_start, 8, 'OY1', 'closed'),
    (v_slin_oy2, v_node_slin_oy2, v_contract_id, '6100AC', 'Option Year 2 Labor/Fee', 'Labor/Fee', v_oy2_start, v_oy3_start, 8, 'OY2', 'closed'),
    (v_slin_oy3, v_node_slin_oy3, v_contract_id, '6100AD', 'Option Year 3 Labor/Fee', 'Labor/Fee', v_oy3_start, v_oy3_end, 8, 'OY3', 'active'),
    (v_slin_odc, v_node_slin_odc, v_contract_id, '6100AE', 'ODC — travel and other direct costs', 'ODC/Cost', v_start_date, v_oy3_end, 0, null, 'active');

  -- Funding history — one mod per closed option year, two mods on the
  -- current (OY3) SLIN to mirror a real funding-increase mod mid-period,
  -- and two mods on the ODC SLIN.
  insert into public.slin_funding_history (slin_id, mod_number, mod_date, previous_funding, award_total, cumulative_total, source_document)
  values
    (v_slin_base, 'Mod 01', v_start_date, 0, 1200000, 1200000, 'Base Award'),
    (v_slin_oy1, 'Mod 05', v_oy1_start, 0, 1350000, 1350000, 'Option Year 1 Exercise'),
    (v_slin_oy2, 'Mod 11', v_oy2_start, 0, 1450000, 1450000, 'Option Year 2 Exercise'),
    (v_slin_oy3, 'Mod 17', v_oy3_start, 0, 1500000, 1500000, 'Option Year 3 Exercise'),
    (v_slin_oy3, 'Mod 19', v_oy3_start + interval '3 months', 1500000, 250000, 1750000, 'Option Year 3 Funding Modification'),
    (v_slin_odc, 'Mod 01', v_start_date, 0, 350000, 350000, 'Base Award — ODC'),
    (v_slin_odc, 'Mod 12', v_oy2_start, 350000, 100000, 450000, 'ODC Funding Increase');

  insert into public.labor_categories (labor_category_id, title) values
    (v_lc_analyst, 'Senior Analyst'),
    (v_lc_pm, 'Program Manager');

  -- ---------------- Personas ----------------
  insert into public.personas (id, slug, display_role, description, category, sort_order)
  values
    (v_persona_employee, 'employee', 'Employee', 'Log time against contract SLINs and submit travel estimates/expenses for your own trips.', 'employee', 1),
    (v_persona_supervisor, 'supervisor', 'Supervisor', 'Everything an Employee can do, plus approve travel estimates and expense reports for your team.', 'employee', 2),
    (v_persona_cust_admin, 'customer_admin', 'Customer Admin', 'View the Contract Financial Dashboard and open/close ODC commitments on behalf of Axiom Forward Consulting.', 'customer', 3),
    (v_persona_cust_viewer, 'customer_viewer', 'Customer Viewer', 'View the Contract Financial Dashboard for Axiom Forward Consulting (read-only).', 'customer', 4);

  -- ---------------- Template employees ----------------
  insert into public.demo_employees (id, persona_id, owner_profile_id, full_name, job_title, department)
  values
    (v_emp_analyst, v_persona_employee, null, 'Jordan Ellis', 'Senior Analyst', 'Program Operations'),
    (v_emp_pm, v_persona_supervisor, null, 'Morgan Reyes', 'Program Manager', 'Program Operations');

  insert into public.employee_rates (employee_id, labor_category_id, slin_id, bill_rate, bill_rate_with_fee, effective_start)
  values
    (v_emp_analyst, v_lc_analyst, null, 95, 102.60, v_start_date),
    (v_emp_pm, v_lc_pm, null, 145, 156.60, v_start_date);

  -- ---------------- Time entries — weekly, ~3.5 years, routed to
  -- whichever SLIN's PoP covers that week. Jordan works full-time (40h/wk);
  -- Morgan bills PM oversight time (6h/wk) against the same SLINs. ----
  insert into public.time_entries (employee_id, slin_id, work_date, hours, status)
  select v_emp_analyst, s.slin_id, wk.work_date, 40, 'approved'
  from generate_series(v_start_date, current_date, interval '7 days') as wk(work_date)
  join public.slins s
    on s.contract_id = v_contract_id and s.slin_category = 'Labor/Fee'
    and wk.work_date >= s.pop_start and wk.work_date < s.pop_end;

  insert into public.time_entries (employee_id, slin_id, work_date, hours, status)
  select v_emp_pm, s.slin_id, wk.work_date, 6, 'approved'
  from generate_series(v_start_date, current_date, interval '7 days') as wk(work_date)
  join public.slins s
    on s.contract_id = v_contract_id and s.slin_category = 'Labor/Fee'
    and wk.work_date >= s.pop_start and wk.work_date < s.pop_end;

  -- ---------------- Travel history — quarterly trips, all expensed/paid
  -- (historical), created by Jordan, approved by Morgan. ----------------
  insert into public.travel_estimates (id, created_by, slin_id, status, destination_event, leave_date, return_date, estimated_total_odc, approved_by, approved_at)
  select
    gen_random_uuid(), v_emp_analyst, v_slin_odc, 'paid',
    'Client site visit — Program Review Q' || (row_number() over (order by trip_date))::text,
    trip_date, trip_date + 3, 2400 + (row_number() over (order by trip_date)) * 75,
    v_emp_pm, trip_date - 5
  from (
    select generate_series(v_start_date + interval '2 months', current_date - interval '2 months', interval '3 months')::date as trip_date
  ) t;

  insert into public.travel_expenses (estimate_id, slin_id, created_by, current_status, supervisor_status, actual_total_odc, supervisor_by, supervisor_at)
  select te.id, te.slin_id, te.created_by, 'paid', 'approved', te.estimated_total_odc - 120, te.approved_by, te.approved_at + interval '10 days'
  from public.travel_estimates te where te.created_by = v_emp_analyst;

  -- One current, still-open estimate so the demo has an "in flight" trip.
  insert into public.travel_estimates (created_by, slin_id, status, destination_event, leave_date, return_date, estimated_total_odc)
  values (v_emp_analyst, v_slin_odc, 'submitted', 'Client site visit — upcoming Program Review', current_date + 14, current_date + 17, 2650);

  -- ---------------- ODC commitments — mix of closed (historical) and
  -- open (current), all created by Jordan (no seeded customer_users yet
  -- to attribute these to). ----------------
  insert into public.odc_commitments (slin_id, description, reference_number, committed_amount, status, expected_date, actual_amount, actual_date, created_by_employee_id, closed_by_employee_id, closed_at)
  values
    (v_slin_odc, 'Laptop refresh — 3 units', 'PO-2024-0091', 4800, 'closed', v_start_date + interval '4 months', 4650, v_start_date + interval '5 months', v_emp_analyst, v_emp_pm, v_start_date + interval '5 months'),
    (v_slin_odc, 'Conference registration — annual program summit', 'PO-2024-0140', 3200, 'closed', v_oy1_start, 3200, v_oy1_start + interval '10 days', v_emp_analyst, v_emp_pm, v_oy1_start + interval '10 days'),
    (v_slin_odc, 'Software licenses — analytics toolset renewal', 'PO-2025-0022', 6000, 'closed', v_oy2_start, 5800, v_oy2_start + interval '20 days', v_emp_analyst, v_emp_pm, v_oy2_start + interval '20 days'),
    (v_slin_odc, 'Printing and materials — client deliverable binders', 'PO-2025-0180', 850, 'open', current_date + interval '15 days', null, null, v_emp_analyst, null, null),
    (v_slin_odc, 'Software licenses — analytics toolset renewal (current term)', 'PO-2026-0031', 6200, 'open', current_date + interval '30 days', null, null, v_emp_analyst, null, null);

end $$;
