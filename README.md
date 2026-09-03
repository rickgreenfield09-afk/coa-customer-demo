# COA Customer Demo — Contract Financial Dashboard & Travel Demo

Prospect-facing demo of the Contract Financial Dashboard (CLIN/SLIN burndown, ODC
commitments) and Travel estimate/reimbursement workflow, seeded with 3-4 years of fake
historical data for a fictional company, "Cyber Offset Alliance."

This is a **standalone commercial build**, separate from the GCC-track COA Self Service
Portal. Stack: Supabase (Postgres + Auth + Storage) + plain HTML/CSS/JS + Vercel. No
frontend framework, no build step.

## Status

Scaffold only as of this commit. Schema is drafted in `supabase/migrations/`, not yet
run against the live Supabase project. See `docs/HANDOFF.md` for full context, decisions
made, and open items before building screens.

## Stack

- **Frontend:** plain HTML/CSS/JS, served as static files, no bundler.
- **Backend:** Supabase (Postgres, Auth — magic link, Storage — for logo uploads).
- **Hosting:** Vercel, deployed from this repo.

## Project structure

```
/
├── index.html            # landing / magic-link request (placeholder)
├── css/
│   └── style.css
├── js/
│   ├── supabaseClient.js # Supabase client init (reads env-injected config)
│   └── app.js
├── supabase/
│   └── migrations/
│       └── 0001_core_schema.sql   # full schema + RLS, Supabase-native (auth.uid())
└── docs/
    └── HANDOFF.md         # design decisions, open items, next steps
```

## Environment variables (Vercel project settings)

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Do not commit a service role key anywhere in this repo.

## Setting up Supabase

1. Run `supabase/migrations/0001_core_schema.sql` against the project via the Supabase
   SQL editor or CLI.
2. Auth → Providers → Email → enable Magic Link; disable "Allow new users to sign up"
   (signup is invite-only — use Supabase's "Invite user").
3. Storage → create a public bucket named `org-logos` for white-label logo uploads.
4. Update Auth → Site URL / Redirect URLs once the Vercel domain is live.

See `docs/HANDOFF.md` for the full design history.

