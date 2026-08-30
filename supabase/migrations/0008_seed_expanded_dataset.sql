-- =====================================================================
-- Expanded seed dataset — 4 contracts across 3 fictional issuing
-- organizations, 9 Task Orders total, each with its own Base/Option-Year
-- Labor/Fee SLINs + an ODC/Travel SLIN, funding history, dedicated
-- template staff, time entries, travel history, and ODC commitments.
--
-- SLIN coding scheme (to keep contracts visually distinct in the
-- picker): 6100=Contract 1/TO1 (existing), 6150=C1/TO2, 6200/6250/6280=
-- C2's three TOs, 6300/6350=C3's two TOs, 6400/6450=C4's two TOs.
--
-- Every new employee pair is dedicated to exactly one Task Order (no
-- sharing across TOs) specifically to avoid unrealistic overlapping
-- 40hr/week double-booking — see the seed_task_order() comments below.
--
-- Structure (SLIN coding, funding-mod previous/award/cumulative format,
-- POC roles, DPAS/payment-terms fields) is adapted from a real Task
-- Order Mod document for realism — the issuing organizations, contract
-- numbers, and every name/email/phone below are entirely fictional
-- (organizations use the .example TLD, reserved by IANA for exactly
-- this purpose, and 555 exchange numbers). None of the real document's
-- company names, contract numbers, or personal contact info are used
-- anywhere in this file.
--
-- Run once, after 0007. Adds to the existing seed from 0003 — does not
-- remove or alter Contract 1 / Task Order 0001.
-- =====================================================================

create or replace function public._seed_task_order(
  p_contract_id uuid, p_customer_id uuid, p_parent_node uuid,
  p_to_label text, p_to_code_prefix text, p_odc_code text,
  p_to_start date, p_to_end date, p_base_count int, p_oy_count int,
  p_analyst_name text, p_analyst_title text, p_analyst_rate numeric, p_analyst_rate_fee numeric,
  p_pm_name text, p_pm_title text, p_pm_rate numeric, p_pm_rate_fee numeric,
  p_lc_analyst uuid, p_lc_pm uuid, p_fee_pct numeric
) returns void language plpgsql as $fn$
declare
  v_to_node uuid := gen_random_uuid();
  v_analyst_id uuid := gen_random_uuid();
  v_pm_id uuid := gen_random_uuid();
  v_slin_node uuid; v_slin_id uuid; v_odc_node uuid; v_odc_slin_id uuid;
  v_seq int; v_award numeric; v_odc_award numeric; v_oy_start date; v_pop_start date; v_pop_end date;
  v_is_active boolean := p_to_end >= current_date;
  v_persona_employee uuid; v_persona_supervisor uuid;
begin
  select id into v_persona_employee from public.personas where slug = 'employee';
  select id into v_persona_supervisor from public.personas where slug = 'supervisor';

  insert into public.demo_employees (id, persona_id, owner_profile_id, full_name, job_title, department)
  values
    (v_analyst_id, v_persona_employee, null, p_analyst_name, p_analyst_title, 'Program Operations'),
    (v_pm_id, v_persona_supervisor, null, p_pm_name, p_pm_title, 'Program Operations');

  insert into public.employee_rates (employee_id, labor_category_id, slin_id, bill_rate, bill_rate_with_fee, effective_start)
  values
    (v_analyst_id, p_lc_analyst, null, p_analyst_rate, p_analyst_rate_fee, p_to_start),
    (v_pm_id, p_lc_pm, null, p_pm_rate, p_pm_rate_fee, p_to_start);

  insert into public.billing_nodes (node_id, parent_node_id, customer_id, contract_id, node_type, label, is_leaf, sort_order, effective_start, effective_end)
    values (v_to_node, p_parent_node, p_customer_id, p_contract_id, 'Task Order', p_to_label, false, 1, p_to_start, p_to_end);

  v_oy_start := p_to_start + (((p_to_end - p_to_start) * 0.65)::int);

  -- Base Year Labor/Fee SLINs
  for v_seq in 1..p_base_count loop
    v_slin_node := gen_random_uuid(); v_slin_id := gen_random_uuid();
    v_award := 90000 + v_seq * 32000 + (random() * 18000)::int;
    insert into public.billing_nodes (node_id, parent_node_id, customer_id, contract_id, node_type, label, is_leaf, sort_order, effective_start, effective_end)
      values (v_slin_node, v_to_node, p_customer_id, p_contract_id, 'SLIN', p_to_code_prefix || chr(64 + v_seq) || ' — Base Year Labor/Fee', true, v_seq, p_to_start, v_oy_start);
    insert into public.slins (slin_id, billing_node_id, contract_id, slin_code, slin_description, slin_category, pop_start, pop_end, fee_percentage, option_year, status)
      values (v_slin_id, v_slin_node, p_contract_id, p_to_code_prefix || chr(64 + v_seq), 'Base Year Labor/Fee Support', 'Labor/Fee', p_to_start, v_oy_start, p_fee_pct, 'Base', case when v_oy_start < current_date then 'closed' else 'active' end);
    insert into public.slin_funding_history (slin_id, mod_number, mod_date, previous_funding, award_total, cumulative_total, source_document)
      values (v_slin_id, 'Mod 01', p_to_start, 0, v_award, v_award, 'Base Award');
    insert into public.time_entries (employee_id, slin_id, work_date, hours, status)
      select v_analyst_id, v_slin_id, wk, 40, 'approved'
      from generate_series(p_to_start, least(v_oy_start, current_date + 1) - 1, interval '7 days') wk
      where wk::date < least(v_oy_start, current_date + 1);
    insert into public.time_entries (employee_id, slin_id, work_date, hours, status)
      select v_pm_id, v_slin_id, wk, 6, 'approved'
      from generate_series(p_to_start, least(v_oy_start, current_date + 1) - 1, interval '7 days') wk
      where wk::date < least(v_oy_start, current_date + 1);
  end loop;

  -- Option Year Labor/Fee SLINs
  for v_seq in 1..p_oy_count loop
    v_slin_node := gen_random_uuid(); v_slin_id := gen_random_uuid();
    v_award := 70000 + v_seq * 28000 + (random() * 15000)::int;
    v_pop_start := v_oy_start; v_pop_end := p_to_end;
    insert into public.billing_nodes (node_id, parent_node_id, customer_id, contract_id, node_type, label, is_leaf, sort_order, effective_start, effective_end)
      values (v_slin_node, v_to_node, p_customer_id, p_contract_id, 'SLIN', p_to_code_prefix || chr(64 + p_base_count + v_seq) || ' — Option Year Labor/Fee', true, p_base_count + v_seq, v_pop_start, v_pop_end);
    insert into public.slins (slin_id, billing_node_id, contract_id, slin_code, slin_description, slin_category, pop_start, pop_end, fee_percentage, option_year, status)
      values (v_slin_id, v_slin_node, p_contract_id, p_to_code_prefix || chr(64 + p_base_count + v_seq), 'Option Year Labor/Fee Support', 'Labor/Fee', v_pop_start, v_pop_end, p_fee_pct, 'OY1', case when v_pop_end < current_date then 'closed' else 'active' end);
    insert into public.slin_funding_history (slin_id, mod_number, mod_date, previous_funding, award_total, cumulative_total, source_document)
      values (v_slin_id, 'Mod 01', v_pop_start, 0, v_award, v_award, 'Option Year Exercise');
    insert into public.time_entries (employee_id, slin_id, work_date, hours, status)
      select v_analyst_id, v_slin_id, wk, 40, 'approved'
      from generate_series(v_pop_start, least(v_pop_end, current_date + 1) - 1, interval '7 days') wk
      where wk::date < least(v_pop_end, current_date + 1) and v_pop_start <= current_date;
    insert into public.time_entries (employee_id, slin_id, work_date, hours, status)
      select v_pm_id, v_slin_id, wk, 6, 'approved'
      from generate_series(v_pop_start, least(v_pop_end, current_date + 1) - 1, interval '7 days') wk
      where wk::date < least(v_pop_end, current_date + 1) and v_pop_start <= current_date;
  end loop;

  -- ODC/Travel SLIN, spanning the whole Task Order
  v_odc_node := gen_random_uuid(); v_odc_slin_id := gen_random_uuid();
  insert into public.billing_nodes (node_id, parent_node_id, customer_id, contract_id, node_type, label, is_leaf, sort_order, effective_start, effective_end)
    values (v_odc_node, v_to_node, p_customer_id, p_contract_id, 'SLIN', p_odc_code || ' — ODC/Travel', true, p_base_count + p_oy_count + 1, p_to_start, p_to_end);
  insert into public.slins (slin_id, billing_node_id, contract_id, slin_code, slin_description, slin_category, pop_start, pop_end, fee_percentage, status)
    values (v_odc_slin_id, v_odc_node, p_contract_id, p_odc_code, 'ODC — travel and other direct costs', 'ODC/Cost', p_to_start, p_to_end, 0, case when p_to_end < current_date then 'closed' else 'active' end);
  v_odc_award := 15000 + (random() * 25000)::int;
  insert into public.slin_funding_history (slin_id, mod_number, mod_date, previous_funding, award_total, cumulative_total, source_document)
    values (v_odc_slin_id, 'Mod 01', p_to_start, 0, v_odc_award, v_odc_award, 'Base Award — ODC');

  -- Quarterly travel history against the ODC SLIN, through today
  insert into public.travel_estimates (id, created_by, slin_id, status, destination_event, leave_date, return_date, estimated_total_odc, approved_by, approved_at)
  select gen_random_uuid(), v_analyst_id, v_odc_slin_id, 'paid',
    p_to_label || ' — Site Visit ' || (row_number() over (order by trip_date))::text,
    trip_date, trip_date + 3, 1800 + (row_number() over (order by trip_date)) * 60, v_pm_id, trip_date - 5
  from (select generate_series(p_to_start + interval '2 months', least(p_to_end, current_date) - interval '2 months', interval '4 months')::date as trip_date) t
  where trip_date < current_date - interval '2 months';

  insert into public.travel_expenses (estimate_id, slin_id, created_by, current_status, supervisor_status, actual_total_odc, supervisor_by, supervisor_at)
  select te.id, te.slin_id, te.created_by, 'paid', 'approved', te.estimated_total_odc - 90, te.approved_by, te.approved_at + interval '10 days'
  from public.travel_estimates te where te.created_by = v_analyst_id and te.slin_id = v_odc_slin_id;

  -- ODC commitments — one closed (historical), and if still active, one open
  insert into public.odc_commitments (slin_id, description, reference_number, committed_amount, status, expected_date, actual_amount, actual_date, created_by_employee_id, closed_by_employee_id, closed_at)
  values (v_odc_slin_id, 'Equipment and materials — task order kickoff', 'PO-' || to_char(p_to_start, 'YYYY') || '-' || (100 + (random() * 800)::int)::text,
    2500 + (random() * 3000)::int, 'closed', p_to_start + interval '3 months', 2400 + (random() * 3000)::int, p_to_start + interval '4 months', v_analyst_id, v_pm_id, p_to_start + interval '4 months');

  if v_is_active then
    insert into public.odc_commitments (slin_id, description, reference_number, committed_amount, status, expected_date, created_by_employee_id)
    values (v_odc_slin_id, 'Software licenses — current term renewal', 'PO-' || to_char(current_date, 'YYYY') || '-' || (100 + (random() * 800)::int)::text,
      1800 + (random() * 4000)::int, 'open', current_date + interval '30 days', v_analyst_id);
  end if;
end;
$fn$;

do $$
declare
  v_customer_id uuid;
  v_node_customer uuid;
  v_contract1_id uuid;
  v_lc_analyst uuid; v_lc_pm uuid;
  v_contract2_id uuid := gen_random_uuid();
  v_contract3_id uuid := gen_random_uuid();
  v_contract4_id uuid := gen_random_uuid();
  v_node_contract2 uuid := gen_random_uuid();
  v_node_contract3 uuid := gen_random_uuid();
  v_node_contract4 uuid := gen_random_uuid();
begin
  select customer_id into v_customer_id from public.customers where is_default_demo_company = true;
  select node_id into v_node_customer from public.billing_nodes where node_type = 'Customer' and customer_id = v_customer_id;
  select contract_id into v_contract1_id from public.contracts where customer_id = v_customer_id limit 1;
  select labor_category_id into v_lc_analyst from public.labor_categories where title = 'Senior Analyst';
  select labor_category_id into v_lc_pm from public.labor_categories where title = 'Program Manager';

  -- ---------------- Contract 1 (existing) — add metadata + contacts + a 2nd Task Order ----------------
  update public.contracts set issuing_organization = 'Solari Federal Solutions', dpas_priority_rating = 'DO-A7', payment_terms = 'Net 30'
    where contract_id = v_contract1_id;

  insert into public.contract_contacts (contract_id, contact_role, name, email, phone) values
    (v_contract1_id, 'Technical POC', 'Diane Forsythe', 'diane.forsythe@solarifederal.example', '555-0142'),
    (v_contract1_id, 'Contractual POC', 'Raymond Cho', 'raymond.cho@solarifederal.example', '555-0187'),
    (v_contract1_id, 'Security POC', 'Nicole Abernathy', 'nicole.abernathy@solarifederal.example', '555-0119');

  perform public._seed_task_order(
    v_contract1_id, v_customer_id, (select node_id from public.billing_nodes where contract_id = v_contract1_id and node_type = 'Contract' limit 1),
    'Task Order 0002', '6150', '7150',
    (current_date - interval '2 years')::date, (current_date - interval '3 months')::date, 3, 1,
    'Priya Nandan', 'Data Analyst', 92, 99.36, 'Devon Cole', 'Task Lead', 140, 151.20,
    v_lc_analyst, v_lc_pm, 8);

  -- ---------------- Contract 2 — Northgate Defense Group (2 contracts) ----------------
  insert into public.contracts (contract_id, customer_id, prime_contract_number, delivery_order_number, subcontract_number, contract_type, fee_type, fee_percentage, line_item_label, status, issuing_organization, dpas_priority_rating, payment_terms)
    values (v_contract2_id, v_customer_id, 'N00178-22-D-5541', 'DO-0012', '4471-0002', 'CPFF', 'Fixed Fee', 7, 'SLIN', 'active', 'Northgate Defense Group', 'DO-B4', 'Net 30');
  insert into public.billing_nodes (node_id, parent_node_id, customer_id, contract_id, node_type, label, is_leaf, sort_order, effective_start)
    values (v_node_contract2, v_node_customer, v_customer_id, v_contract2_id, 'Contract', 'N00178-22-D-5541 / DO-0012', false, 2, current_date - interval '3 years');
  insert into public.contract_contacts (contract_id, contact_role, name, email, phone) values
    (v_contract2_id, 'Technical POC', 'Walter Higgins', 'walter.higgins@northgatedefense.example', '555-0231'),
    (v_contract2_id, 'Contractual POC', 'Priscilla Nguyen', 'priscilla.nguyen@northgatedefense.example', '555-0256'),
    (v_contract2_id, 'Security POC', 'Aaron Beltran', 'aaron.beltran@northgatedefense.example', '555-0209');

  perform public._seed_task_order(v_contract2_id, v_customer_id, v_node_contract2, 'Task Order 0201', '6200', '7200',
    (current_date - interval '3 years')::date, (current_date - interval '1 years 3 months')::date, 4, 2,
    'Elena Vasquez', 'Systems Engineer', 98, 104.86, 'Marcus Webb', 'Program Manager', 148, 158.36, v_lc_analyst, v_lc_pm, 7);
  perform public._seed_task_order(v_contract2_id, v_customer_id, v_node_contract2, 'Task Order 0202', '6250', '7250',
    (current_date - interval '1 years 2 months')::date, (current_date + interval '3 months')::date, 3, 1,
    'Grace Liu', 'Business Analyst', 90, 96.30, 'Samuel Ortiz', 'Program Manager', 142, 151.94, v_lc_analyst, v_lc_pm, 7);
  perform public._seed_task_order(v_contract2_id, v_customer_id, v_node_contract2, 'Task Order 0203', '6280', '7280',
    (current_date - interval '2 months')::date, (current_date + interval '10 months')::date, 2, 1,
    'Felicia Grant', 'Junior Analyst', 78, 83.46, 'Isaac Whitmore', 'Program Manager', 136, 145.52, v_lc_analyst, v_lc_pm, 7);

  -- ---------------- Contract 3 — Vantage Point Systems ----------------
  insert into public.contracts (contract_id, customer_id, prime_contract_number, delivery_order_number, subcontract_number, contract_type, fee_type, fee_percentage, line_item_label, status, issuing_organization, payment_terms)
    values (v_contract3_id, v_customer_id, 'GS-35F-0198X', 'DO-0044', 'VP-2231', 'T&M', null, null, 'SLIN', 'active', 'Vantage Point Systems', 'Net 45');
  insert into public.billing_nodes (node_id, parent_node_id, customer_id, contract_id, node_type, label, is_leaf, sort_order, effective_start)
    values (v_node_contract3, v_node_customer, v_customer_id, v_contract3_id, 'Contract', 'GS-35F-0198X / DO-0044', false, 3, current_date - interval '2 years 6 months');
  insert into public.contract_contacts (contract_id, contact_role, name, email, phone) values
    (v_contract3_id, 'Technical POC', 'Gabriel Osei', 'gabriel.osei@vantagepoint.example', '555-0312'),
    (v_contract3_id, 'Contractual POC', 'Renee Castellano', 'renee.castellano@vantagepoint.example', '555-0348');

  perform public._seed_task_order(v_contract3_id, v_customer_id, v_node_contract3, 'Task Order 0301', '6300', '7300',
    (current_date - interval '2 years 6 months')::date, (current_date - interval '6 months')::date, 4, 1,
    'Sara Kim', 'Business Analyst', 88, 88, 'Thomas Bradley', 'Supervisor', 138, 138, v_lc_analyst, v_lc_pm, 0);
  perform public._seed_task_order(v_contract3_id, v_customer_id, v_node_contract3, 'Task Order 0302', '6350', '7350',
    (current_date - interval '5 months')::date, (current_date + interval '7 months')::date, 2, 2,
    'Adrian Voss', 'Analyst', 91, 91, 'Camille Dupree', 'Supervisor', 141, 141, v_lc_analyst, v_lc_pm, 0);

  -- ---------------- Contract 4 — Northgate Defense Group (2nd contract) ----------------
  insert into public.contracts (contract_id, customer_id, prime_contract_number, delivery_order_number, subcontract_number, contract_type, fee_type, fee_percentage, line_item_label, status, issuing_organization, dpas_priority_rating, payment_terms)
    values (v_contract4_id, v_customer_id, 'N00178-24-D-7702', 'DO-0003', '4471-0009', 'FFP', null, null, 'SLIN', 'active', 'Northgate Defense Group', 'DO-C2', 'Net 15');
  insert into public.billing_nodes (node_id, parent_node_id, customer_id, contract_id, node_type, label, is_leaf, sort_order, effective_start)
    values (v_node_contract4, v_node_customer, v_customer_id, v_contract4_id, 'Contract', 'N00178-24-D-7702 / DO-0003', false, 4, current_date - interval '18 months');
  insert into public.contract_contacts (contract_id, contact_role, name, email, phone) values
    (v_contract4_id, 'Technical POC', 'Monica Ferraro', 'monica.ferraro@northgatedefense.example', '555-0271'),
    (v_contract4_id, 'Contractual POC', 'Priscilla Nguyen', 'priscilla.nguyen@northgatedefense.example', '555-0256');

  perform public._seed_task_order(v_contract4_id, v_customer_id, v_node_contract4, 'Task Order 0401', '6400', '7400',
    (current_date - interval '18 months')::date, (current_date + interval '6 months')::date, 3, 1,
    'Nadia Farouk', 'Financial Analyst', 87, 87, 'Owen Whitfield', 'Program Manager', 133, 133, v_lc_analyst, v_lc_pm, 0);
  perform public._seed_task_order(v_contract4_id, v_customer_id, v_node_contract4, 'Task Order 0402', '6450', '7450',
    (current_date - interval '1 months')::date, (current_date + interval '11 months')::date, 2, 1,
    'Renata Silva', 'Analyst', 84, 84, 'Julian Marsh', 'Program Manager', 130, 130, v_lc_analyst, v_lc_pm, 0);
end $$;

drop function public._seed_task_order(uuid, uuid, uuid, text, text, text, date, date, int, int, text, text, numeric, numeric, text, text, numeric, numeric, uuid, uuid, numeric);
