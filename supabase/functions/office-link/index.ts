// 🔗 Link to the ServPlus CRM (2026-11-25, Company Stats). Only the owner + office manager (office_is_staff()) may use it.
// It passes the request to the ServPlus CRM's function "crm-office-link" with the shared secret, so the secret never
// reaches a browser. The ServPlus CRM never sees anything else in the Office CRM.
// Deploy: Supabase (ServPlus Office) → Edge Functions → Deploy a new function → Via Editor → name "office-link" → paste.
// Secrets: OFFICE_LINK_KEY = the same long random text as on the ServPlus CRM; CRM_LINK_URL = the ServPlus CRM's
// https://<project>.supabase.co/functions/v1/crm-office-link

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const ACTIONS = ["stats", "set", "setWeek", "auto"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: staff, error } = await sb.rpc("office_is_staff");
  if (error || staff !== true) return reply({ error: "Not allowed" }, 403);

  const key = Deno.env.get("OFFICE_LINK_KEY"), url = Deno.env.get("CRM_LINK_URL");
  if (!key || !url) return reply({ error: "The link to the ServPlus CRM isn't set up yet (OFFICE_LINK_KEY / CRM_LINK_URL)." }, 500);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (!ACTIONS.includes(body.action)) return reply({ error: "Unknown action" }, 400);
  const { data: u } = await sb.auth.getUser();
  const { data: me } = await sb.from("office_staff").select("name").ilike("email", u.user?.email || "").maybeSingle();
  body.by = me?.name || u.user?.email || "Office CRM";

  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-office-key": key }, body: JSON.stringify(body) });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return reply({ error: "Couldn't reach the ServPlus CRM: " + String((e as Error)?.message || e) }, 502);
  }
});
