// Supabase client init.
//
// This demo has no build step, so config is injected at deploy time by
// replacing the placeholders below (e.g. via a small Vercel build command,
// or a generated config.js loaded before this file) rather than reading
// process.env directly in the browser. Not yet wired up — placeholder only.
//
// Loaded via CDN in index.html:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>

const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("Supabase config missing — set window.__ENV__ before loading this file.");
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
