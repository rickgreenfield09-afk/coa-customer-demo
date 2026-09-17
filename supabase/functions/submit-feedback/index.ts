// submit-feedback — Supabase Edge Function
//
// Accepts demo feedback from the floating "Demo Feedback" widget and
// forwards it server-side to a Power Automate "When an HTTP request is
// received" trigger, which writes the item into the SharePoint feedback
// list. The Power Automate trigger URL never reaches the browser (set as
// an Edge Function secret: FEEDBACK_FLOW_URL).
//
// The caller's email is always taken from their verified Supabase auth
// session, never from the request body — the widget only appears inside
// app-shell (post-OTP), so every submission is tied to a known user.
//
// Client contract: POST { feedbackType, screenName, severity,
// issueDescription, reproductionSteps, dateSubmitted }, Authorization
// header set to the caller's Supabase access token (supabaseClient
// .functions.invoke() does this automatically).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TEXT_LENGTH = 4000;

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
    if (userError || !user || !user.email) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json();
    const { feedbackType, screenName, severity, issueDescription, reproductionSteps, dateSubmitted } = body;

    if (!feedbackType || !screenName || !severity || !issueDescription) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: corsHeaders });
    }
    if (
      String(issueDescription).length > MAX_TEXT_LENGTH ||
      String(reproductionSteps ?? '').length > MAX_TEXT_LENGTH
    ) {
      return new Response(JSON.stringify({ error: 'Field too long' }), { status: 400, headers: corsHeaders });
    }

    const flowUrl = Deno.env.get('FEEDBACK_FLOW_URL');
    if (!flowUrl) {
      return new Response(JSON.stringify({ error: 'Feedback submission is not configured' }), { status: 500, headers: corsHeaders });
    }

    const flowRes = await fetch(flowUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Email: user.email,
        DateSubmitted: dateSubmitted || new Date().toISOString(),
        FeedbackType: String(feedbackType).slice(0, 200),
        ScreenName: String(screenName).slice(0, 200),
        Severity: String(severity).slice(0, 200),
        IssueDescription: String(issueDescription).slice(0, MAX_TEXT_LENGTH),
        ReproductionSteps: String(reproductionSteps ?? '').slice(0, MAX_TEXT_LENGTH),
      }),
    });

    if (!flowRes.ok) {
      const errText = await flowRes.text();
      return new Response(JSON.stringify({ error: 'Power Automate error: ' + errText }), { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
