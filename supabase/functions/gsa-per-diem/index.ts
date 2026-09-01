// gsa-per-diem — Supabase Edge Function
//
// Looks up the current GSA per diem rates (lodging ceiling by month + flat
// daily M&IE) for a city/state or zip, for the Travel Estimate form's
// "Look Up GSA Rates" button. The GSA API key never reaches the browser
// (set as an Edge Function secret: GSA_API_KEY).
//
// Client contract: POST { city?, state?, zip?, year, month } (city+state OR
// zip is required; month is 1-12, used to pick the right lodging-rate
// column out of GSA's per-month response), Authorization header set to the
// caller's Supabase access token (supabaseClient.functions.invoke() does
// this automatically) — this function doesn't need the caller's identity
// for anything, it just requires a signed-in session like the rest of the
// app's data access.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
    }

    const { city, state, zip, year, month } = await req.json();
    const hasCityState = city && state;
    if (!hasCityState && !zip) {
      return new Response(JSON.stringify({ error: 'city+state or zip is required' }), { status: 400, headers: corsHeaders });
    }
    const rateYear = year || new Date().getFullYear();
    const monthNum = Number(month) || (new Date().getMonth() + 1);

    const apiKey = Deno.env.get('GSA_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GSA lookup is not configured' }), { status: 500, headers: corsHeaders });
    }

    const gsaUrl = hasCityState
      ? `https://api.gsa.gov/travel/perdiem/v2/rates/city/${encodeURIComponent(city)}/state/${encodeURIComponent(state)}/year/${rateYear}`
      : `https://api.gsa.gov/travel/perdiem/v2/rates/zip/${encodeURIComponent(zip)}/year/${rateYear}`;

    const gsaRes = await fetch(gsaUrl, { headers: { 'X-API-KEY': apiKey } });
    if (!gsaRes.ok) {
      const errText = await gsaRes.text();
      return new Response(JSON.stringify({ error: 'GSA API error: ' + errText }), { status: 502, headers: corsHeaders });
    }
    const gsaData = await gsaRes.json();

    const rateItem = gsaData?.rates?.[0]?.rate?.[0];
    if (!rateItem) {
      return new Response(JSON.stringify({ error: 'No GSA rate found for that location — CONUS standard rate may apply; enter rates manually.' }), { status: 404, headers: corsHeaders });
    }

    const monthKey = MONTH_KEYS[monthNum - 1];
    const monthEntry = (rateItem.months?.month || []).find((m: any) => m.short?.toLowerCase() === monthKey);
    const lodgingRate = monthEntry ? Number(monthEntry.value) : Number(rateItem.months?.month?.[0]?.value) || null;
    const mealsRate = Number(rateItem.meals) || null;

    return new Response(JSON.stringify({
      lodgingRate,
      mealsRate,
      city: rateItem.city,
      state: gsaData?.rates?.[0]?.state,
      isStandardRate: !!rateItem.isStandardRate,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
