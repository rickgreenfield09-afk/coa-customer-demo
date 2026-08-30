-- Light/dark theme preference, mirroring the COA Employee Portal's
-- Profile > Overview toggle. Default dark, matching that app's default.
alter table public.profiles
  add column theme_preference text not null default 'dark' check (theme_preference in ('dark', 'light'));
