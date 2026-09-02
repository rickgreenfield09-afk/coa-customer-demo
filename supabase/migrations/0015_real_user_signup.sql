-- =====================================================================
-- Real user signup: capture Name/Company/Title (in addition to Email,
-- already captured) at first magic-link signup, so a real prospect sees
-- their own company name throughout the app instead of the placeholder
-- "Axiom Forward Consulting". profiles.display_company_name/
-- display_logo_url already existed for exactly this white-label purpose
-- (see their column comments in 0001_core_schema.sql) but were never
-- wired to signup — this finishes that.
--
-- handle_new_auth_user() only fires on a genuine new auth.users row, so
-- an existing/returning user's profile is never overwritten by this.
-- =====================================================================

alter table public.profiles add column title text;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, display_company_name, title)
  values (
    new.id, new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'company_name',
    new.raw_user_meta_data->>'title'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
