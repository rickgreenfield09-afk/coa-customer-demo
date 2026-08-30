// Writes js/env.js from environment variables at deploy time. Vercel runs
// this as the build command (see vercel.json) — SUPABASE_URL and
// SUPABASE_ANON_KEY are set as Vercel project env vars, never committed.
// Locally, js/env.js is hand-created from js/env.example.js instead (see
// README) — this script only needs to run in CI/deploy.
const fs = require('fs');

// Strip stray leading/trailing quotes in case the value was pasted into
// Vercel's dashboard including quote characters (e.g. "eyJ..." instead of
// eyJ...) — a JWT/URL never legitimately contains a leading/trailing ".
function unquote(v) {
  return v.replace(/^"(.*)"$/, '$1');
}

const url = unquote(process.env.SUPABASE_URL || '');
const anonKey = unquote(process.env.SUPABASE_ANON_KEY || '');

if (!url || !anonKey) {
  console.warn('SUPABASE_URL / SUPABASE_ANON_KEY not set — js/env.js will be written with empty values.');
}

const contents = `// Generated at build time by scripts/generate-env.js — do not edit directly.
window.__ENV__ = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(anonKey)}
};
`;

fs.writeFileSync('js/env.js', contents);
console.log('Wrote js/env.js');
