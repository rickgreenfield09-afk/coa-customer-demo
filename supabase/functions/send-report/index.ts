// send-report — Supabase Edge Function
//
// Sends a pre-rendered HTML report to the CALLING USER'S OWN email address
// via Resend. The Resend API key never reaches the browser (set as an Edge
// Function secret: RESEND_API_KEY). The recipient is always derived from the
// caller's own verified auth session, never taken from the request body —
// this is deliberate, so the function can't be used as an open mail relay.
//
// Client contract: POST { subject: string, html: string }, Authorization
// header set to the caller's Supabase access token (supabaseClient.functions
// .invoke() does this automatically).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { subject, html } = await req.json();
    if (!subject || !html) {
      return new Response(JSON.stringify({ error: 'subject and html are required' }), { status: 400, headers: corsHeaders });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromAddress = Deno.env.get('REPORT_FROM_EMAIL');
    if (!resendKey || !fromAddress) {
      return new Response(JSON.stringify({ error: 'Email sending is not configured' }), { status: 500, headers: corsHeaders });
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [user.email],
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return new Response(JSON.stringify({ error: 'Resend error: ' + errText }), { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
