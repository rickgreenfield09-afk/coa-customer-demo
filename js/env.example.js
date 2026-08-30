// Local dev config template. Copy to js/env.js (gitignored — never commit
// real keys) and fill in the values from Supabase project settings
// (Project Settings > API). The anon key is safe for client-side use.
//
// In production (Vercel), window.__ENV__ is injected at deploy time
// instead of this file — see README "Environment variables" section.
window.__ENV__ = {
  SUPABASE_URL: "https://zbcokdvluymdezvirmbq.supabase.co",
  SUPABASE_ANON_KEY: ""
};
