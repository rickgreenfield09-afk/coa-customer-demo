-- =====================================================================
-- Persona clone + demo-session reset lifecycle
--
-- Resolves the two gaps flagged in 0001_core_schema.sql's trailing
-- comment plus the reset-on-logout/idle-timeout requirement decided
-- after that migration:
--   1. Persona cloning must be a security-definer function, not raw
--      client inserts — a guest must not be able to clone an arbitrary
--      demo_employees row (or supply someone else's).
--   2. Guest-created/edited data (clones, their time/travel/ODC rows,
--      customer_users membership) must be fully resettable without any
--      manual data-grooming, while seeded template data is untouched by
--      construction (owner_profile_id is null on every template row).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Schema tweaks: session tracking + FK delete behavior
-- ---------------------------------------------------------------------

alter table public.profiles
  add column session_started_at timestamptz;

-- Rows a guest created themselves are swept when their clone/membership
-- is deleted. Rows recording a *different* persona's action on that data
-- (an approver, a closer) are preserved via SET NULL so resetting one
-- guest's session doesn't erase another guest's still-live approval
-- history.
alter table public.time_entries
  drop constraint time_entries_employee_id_fkey,
  add constraint time_entries_employee_id_fkey
    foreign key (employee_id) references public.demo_employees(id) on delete cascade;

alter table public.travel_estimates
  drop constraint travel_estimates_created_by_fkey,
  add constraint travel_estimates_created_by_fkey
    foreign key (created_by) references public.demo_employees(id) on delete cascade,
  drop constraint travel_estimates_approved_by_fkey,
  add constraint travel_estimates_approved_by_fkey
    foreign key (approved_by) references public.demo_employees(id) on delete set null;

alter table public.travel_expenses
  drop constraint travel_expenses_created_by_fkey,
  add constraint travel_expenses_created_by_fkey
    foreign key (created_by) references public.demo_employees(id) on delete cascade,
  drop constraint travel_expenses_supervisor_by_fkey,
  add constraint travel_expenses_supervisor_by_fkey
    foreign key (supervisor_by) references public.demo_employees(id) on delete set null;

alter table public.odc_commitments
  drop constraint odc_commitments_created_by_employee_id_fkey,
  add constraint odc_commitments_created_by_employee_id_fkey
    foreign key (created_by_employee_id) references public.demo_employees(id) on delete cascade,
  drop constraint odc_commitments_closed_by_employee_id_fkey,
  add constraint odc_commitments_closed_by_employee_id_fkey
    foreign key (closed_by_employee_id) references public.demo_employees(id) on delete set null,
  drop constraint odc_commitments_created_by_customer_user_id_fkey,
  add constraint odc_commitments_created_by_customer_user_id_fkey
    foreign key (created_by_customer_user_id) references public.customer_users(id) on delete cascade,
  drop constraint odc_commitments_closed_by_customer_user_id_fkey,
  add constraint odc_commitments_closed_by_customer_user_id_fkey
    foreign key (closed_by_customer_user_id) references public.customer_users(id) on delete set null;

-- ---------------------------------------------------------------------
-- clone_persona(persona_id) — called once from the role picker on first
-- selection of a given persona. Idempotent: re-selecting a persona the
-- guest already cloned/joined reuses the existing row instead of
-- duplicating it, so it's safe to call every time a persona is picked.
-- ---------------------------------------------------------------------

create function public.clone_persona(p_persona_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_persona record;
  v_template_id uuid;
  v_clone_id uuid;
  v_customer_id uuid;
  v_display_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_persona from public.personas where id = p_persona_id;
  if not found then
    raise exception 'Unknown persona';
  end if;

  if v_persona.category = 'employee' then
    -- Reuse an existing clone for this persona if the guest already has one.
    select id into v_clone_id
      from public.demo_employees
      where owner_profile_id = auth.uid() and persona_id = p_persona_id
      limit 1;

    if v_clone_id is null then
      select id, full_name into v_template_id, v_display_name
        from public.demo_employees
        where persona_id = p_persona_id and owner_profile_id is null
        order by created_at asc
        limit 1;

      if v_template_id is null then
        raise exception 'No template employee is seeded for this persona';
      end if;

      v_clone_id := gen_random_uuid();

      insert into public.demo_employees (id, persona_id, owner_profile_id, template_source_id, full_name, job_title, department)
      select v_clone_id, t.persona_id, auth.uid(), t.id, t.full_name, t.job_title, t.department
      from public.demo_employees t where t.id = v_template_id;

      insert into public.time_entries (id, employee_id, slin_id, work_date, hours, status)
      select gen_random_uuid(), v_clone_id, slin_id, work_date, hours, status
      from public.time_entries where employee_id = v_template_id;

      insert into public.travel_estimates (id, created_by, slin_id, status, destination_event, leave_date, return_date, estimated_total_odc, approved_by, approved_at)
      select gen_random_uuid(), v_clone_id, slin_id, status, destination_event, leave_date, return_date, estimated_total_odc, approved_by, approved_at
      from public.travel_estimates where created_by = v_template_id;
    end if;

    update public.profiles
      set active_persona_id = p_persona_id,
          active_customer_id = null,
          session_started_at = coalesce(session_started_at, now())
      where id = auth.uid();

  elsif v_persona.category = 'customer' then
    if v_persona.slug not in ('customer_admin', 'customer_viewer') then
      raise exception 'Customer persona slug must be customer_admin or customer_viewer';
    end if;

    select customer_id into v_customer_id
      from public.customers where is_default_demo_company = true
      limit 1;

    if v_customer_id is null then
      raise exception 'No default demo company is seeded';
    end if;

    insert into public.customer_users (customer_id, profile_id, role)
      values (v_customer_id, auth.uid(), v_persona.slug)
      on conflict (customer_id, profile_id) do update set role = excluded.role;

    update public.profiles
      set active_persona_id = p_persona_id,
          active_customer_id = v_customer_id,
          session_started_at = coalesce(session_started_at, now())
      where id = auth.uid();

  else
    raise exception 'Unknown persona category: %', v_persona.category;
  end if;
end;
$$;

revoke execute on function public.clone_persona(uuid) from public;
grant execute on function public.clone_persona(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Reset lifecycle. _reset_guest_profile does the actual deletion/reset
-- for one profile; the two public entry points differ only in who's
-- allowed to call them and for whom. Templates (owner_profile_id/
-- created_by_* null) are never touched — reset only ever deletes rows
-- that are owned by (or created under) the target guest profile.
-- ---------------------------------------------------------------------

create function public._reset_guest_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.odc_commitments
    where created_by_customer_user_id in (select id from public.customer_users where profile_id = p_profile_id);

  delete from public.demo_employees where owner_profile_id = p_profile_id;
  -- time_entries/travel_estimates/travel_expenses/odc_commitments
  -- created by those clones cascade-delete via the FKs above.

  delete from public.customer_users where profile_id = p_profile_id;

  update public.profiles
    set active_persona_id = null,
        active_customer_id = null,
        display_company_name = null,
        display_logo_url = null,
        session_started_at = null
    where id = p_profile_id;
end;
$$;

revoke execute on function public._reset_guest_profile(uuid) from public;

-- Called by the client immediately before sign-out, so a guest's own
-- data resets the moment they explicitly log off.
create function public.reset_my_demo_session()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  perform public._reset_guest_profile(auth.uid());
end;
$$;

revoke execute on function public.reset_my_demo_session() from public;
grant execute on function public.reset_my_demo_session() to authenticated;

-- Platform-admin manual sweep of every guest's data (all non-admin profiles).
create function public.admin_reset_all_demo_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin only';
  end if;
  for r in select id from public.profiles where is_platform_admin = false loop
    perform public._reset_guest_profile(r.id);
  end loop;
end;
$$;

revoke execute on function public.admin_reset_all_demo_sessions() from public;
grant execute on function public.admin_reset_all_demo_sessions() to authenticated;

-- Time-limit / abandoned-tab safety net — a guest who closes the browser
-- without logging out never fires reset_my_demo_session(), so a scheduled
-- job (pg_cron, invoked as postgres — not exposed over PostgREST) sweeps
-- any guest session older than p_max_age. Not granted to anon/authenticated.
create function public.sweep_expired_demo_sessions(p_max_age interval default '2 hours')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id from public.profiles
    where is_platform_admin = false
      and session_started_at is not null
      and session_started_at < now() - p_max_age
  loop
    perform public._reset_guest_profile(r.id);
  end loop;
end;
$$;

revoke execute on function public.sweep_expired_demo_sessions(interval) from public;

-- Schedule the sweep every 15 minutes. Requires the pg_cron extension —
-- enable it via Supabase dashboard (Database > Extensions) before this
-- migration runs, or run this select separately after enabling it.
select cron.schedule(
  'sweep-expired-demo-sessions',
  '*/15 * * * *',
  $$select public.sweep_expired_demo_sessions('2 hours'::interval)$$
);
