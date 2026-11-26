// Office CRM assistant (2026-11-25). Runs as a Supabase Edge Function in the OFFICE CRM's own Supabase project, so the
// Anthropic key stays on the server (secret ANTHROPIC_API_KEY). Only the owner + office manager may use it
// (office_is_staff(), supabase/schema.sql). It never pays, orders, approves or saves anything: the CRM shows a check
// screen and saves only when she confirms.
// Deploy: Supabase → Edge Functions → Deploy a new function → Via Editor → name "office-assistant" → paste this file.
//
// mode "scan" = 📄 Smart Scan: reads ONE picture or PDF and says what it is + the details (scan.js).

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5";     // cheap and good at reading documents; switch to "claude-sonnet-5-5" if it misreads
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.10, output: 0.50 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};
const DEFAULT_CAP = 25;   // dollars a month; the owner can change it (action setCap)
const OWNERS = ["emergencyservicellc@gmail.com"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const STR = { type: "string" };
const SCAN_SYSTEM = `You read ONE business document for the office manager of SERVPLUS, a water damage restoration company in
Oregon / Washington. Say what kind of document it is and pull out the details. Never guess numbers you can't read: leave
them "". Dates as YYYY-MM-DD. Amounts as plain numbers like 485.00 (the TOTAL due / paid, not a line).
KIND, pick one:
- "bill": a vendor invoice or statement the company has to pay (has an amount due / due date).
- "shop_receipt": a receipt for parts / supplies bought for the SHOP or equipment repair (Grainger, SupplyHouse, Ferguson, Amazon parts…).
- "jobsite_receipt": a store receipt for supplies used on a customer's job (Home Depot, Lowe's, plastic, tape, fans…).
- "renewal": an insurance policy, contractor license / CCB, certification (IICRC…), workers' comp; anything with an expiration.
- "coi": a certificate of insurance (ACORD 25 etc.). title = who the certificate is for (certificate holder).
- "dmv": a vehicle registration / DMV renewal. title = the vehicle (year make model, plate, or truck #).
- "order": an order confirmation or shipping notice. title = the item; due_date = expected delivery.
- "payment": a payment confirmation / receipt for a bill that was paid. vendor = who was paid; doc_date = paid on.
- "other": anything else.
Fields: vendor (who sent it / the store / the insurer), title (short: what it is for), invoice_no, amount, doc_date (the
document's date), due_date (bills: due date; orders: delivery), expires (renewal / coi / dmv), items (shop receipts only:
each line with name, qty, price each), summary (one short plain sentence), confidence ("high" when everything was clear,
"medium" when something was hard to read, "low" when unsure what the document is).`;
const SCAN_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["bill", "shop_receipt", "jobsite_receipt", "renewal", "coi", "dmv", "order", "payment", "other"] },
    vendor: STR, title: STR, invoice_no: STR, amount: STR, doc_date: STR, due_date: STR, expires: STR,
    items: { type: "array", items: { type: "object", properties: { name: STR, qty: STR, price: STR }, required: ["name", "qty", "price"], additionalProperties: false } },
    summary: STR,
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["kind", "vendor", "title", "invoice_no", "amount", "doc_date", "due_date", "expires", "items", "summary", "confidence"],
  additionalProperties: false,
};

const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).format(new Date());
// deno-lint-ignore no-explicit-any
const costOf = (u: any, model: string) => { const P = PRICES[model] || PRICES[MODEL]; return ((u?.input_tokens || 0) * P.input + (u?.output_tokens || 0) * P.output) / 1e6; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: staff, error: staffErr } = await sb.rpc("office_is_staff");
  if (staffErr || staff !== true) return reply({ error: "Not allowed" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const getRow = async (k: string) => (await admin.from("office_private").select("data").eq("key", k).maybeSingle()).data?.data || {};
  const putRow = (k: string, data: unknown) => admin.from("office_private").upsert({ key: k, data, updated_at: new Date().toISOString() });
  const usageNow = async () => {
    const u = await getRow("ai_usage"), c = await getRow("ai_cap"), month = thisMonth();
    const cap = typeof c.cap === "number" ? c.cap : DEFAULT_CAP;
    return u.month === month ? { month, cost: u.cost || 0, calls: u.calls || 0, cap } : { month, cost: 0, calls: 0, cap };
  };

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "Bad request" }, 400); }

  if (body.action === "usage") return reply(await usageNow());
  if (body.action === "setCap") {
    const { data: me } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!OWNERS.includes((me?.user?.email || "").toLowerCase())) return reply({ error: "Only the owner can change the limit." }, 403);
    const cap = Number(body.cap);
    if (!(cap >= 0 && cap <= 500)) return reply({ error: "Pick a limit between $0 and $500." }, 400);
    await putRow("ai_cap", { cap });
    return reply(await usageNow());
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return reply({ error: "The assistant isn't set up yet (no ANTHROPIC_API_KEY secret)." }, 500);
  const spent = await usageNow();
  if (spent.cost >= spent.cap) return reply({ error: `The assistant reached this month's limit ($${spent.cap}). It starts again on the 1st.`, capped: true }, 429);

  // mode "sort" = 📝 Scratch pad (notepad.js): her brain dump → separate items, each with where it goes. Nothing is saved here.
  // mode "email" = 📧 an email she brought in (email.js): same items, read from the newest message only.
  if (body.mode === "sort" || body.mode === "email") {
    const isMail = body.mode === "email";
    const text = String(body.text || "").slice(0, 8000);
    if (!text.trim()) return reply({ error: "Nothing written" }, 400);
    const SORT_SYSTEM = `You sort an office manager's quick notes for a water damage restoration company (SERVPLUS).
Split the notes into separate things to do / remember (one per item; keep her meaning, clean up spelling, short and plain).
For each pick dest:
- "cal": something on a specific day (an appointment, a reminder for a day). date required.
- "today": a task with no day, to do today (call, email, send, file…). Also a day that is TODAY.
- "bill": a bill to pay. vendor, amount and date (due) when given.
- "shop": something to buy / order for the shop or trucks (text = the item only, amount = price each if given).
- "owner": something to ask the owner / needs the owner's approval. amount if given.
- "renewal": insurance, license, registration, certificate expiring / renewing. date = when it expires.
- "": you can't tell where it goes. Set sure false.
Days: turn "friday", "next tue", "12/3", "dec 15", "tomorrow" into YYYY-MM-DD from TODAY (a weekday = the next one, today counts).
sure = false when you are guessing. amount = a number, no $. Never invent amounts, dates or vendors.${isMail ? `
This is ONE EMAIL she received (FROM / SUBJECT / BODY). List only what SHE has to do or keep track of because of it: a bill to pay (vendor = who sent it), a renewal / expiring policy, a delivery day ("cal"), a question for the owner, a shop item someone asked for, a call or reply ("today"). A payment confirmation = "today" item "Mark the <vendor> bill paid". Ignore signatures, ads, legal footers, unsubscribe text and older quoted replies. Last item: "Reply to <name>: <subject>" (dest "today") only if the email asks something. Ads / newsletters with nothing to do = no items.
READ THE WHOLE EMAIL AND UNDERSTAND IT before writing items. Never copy a sentence out of it. Each item must make sense on its own on a calendar or to-do list months from now: say WHO (the sender's name, from FROM or the signature), WHAT, and WHERE / WHEN if given, in her words. Example: the email says "Call me or write me back to donate, FSM someone in, and/or come in", signed "Daniel Klevit" = "Call or write Daniel Klevit back about donating or coming in". One item per real action, not one per sentence.
summary = what the email is about, one or two plain sentences. next = the single most useful thing for her to do next (or "Nothing to do. Just read it.").` : ""}`;
    const SORT_SCHEMA = isMail
      ? { type: "object", additionalProperties: false, required: ["summary", "next", "items"], properties: { summary: { type: "string" }, next: { type: "string" }, items: { type: "array", items: { type: "object", additionalProperties: false,
          required: ["text", "dest", "date", "amount", "vendor", "sure"],
          properties: { text: { type: "string" }, dest: { type: "string", enum: ["cal", "today", "bill", "shop", "owner", "renewal", ""] }, date: { type: "string" }, amount: { type: ["number", "null"] }, vendor: { type: "string" }, sure: { type: "boolean" } } } } } }
      : { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["text", "dest", "date", "amount", "vendor", "sure"],
      properties: { text: { type: "string" }, dest: { type: "string", enum: ["cal", "today", "bill", "shop", "owner", "renewal", ""] }, date: { type: "string" }, amount: { type: ["number", "null"] }, vendor: { type: "string" }, sure: { type: "boolean" } } } } } };
    try {
      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model: MODEL, max_tokens: 3000,
        output_config: { format: { type: "json_schema", schema: SORT_SCHEMA } },
        system: [{ type: "text", text: SORT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `TODAY: ${String(body.today || "").slice(0, 10)}\n${isMail ? `FROM: ${String(body.from || "").slice(0, 200)}\nSUBJECT: ${String(body.subject || "").slice(0, 300)}\nDATE: ${String(body.date || "").slice(0, 80)}\nBODY:\n` : "NOTES:\n"}${text}` }],
      });
      const after = await usageNow();
      await putRow("ai_usage", { month: after.month, cost: after.cost + costOf(res.usage, MODEL), calls: after.calls + 1 });
      const out = res.content.find((b) => b.type === "text");
      if (!out || out.type !== "text") return reply({ error: "No answer" }, 502);
      const j = JSON.parse(out.text);
      j.items = (j.items || []).map((x: any) => ({ ...x, amount: x.amount ?? "" }));
      return reply({ ...j, cost: costOf(res.usage, MODEL) });
    } catch (err) {
      if (err instanceof Anthropic.APIError) return reply({ error: `Assistant error ${err.status}` }, 502);
      return reply({ error: "Assistant error" }, 500);
    }
  }

  if (body.mode !== "scan") return reply({ error: "Unknown mode" }, 400);
  const mediaType = String(body.mediaType || "");
  const data = String(body.data || "");
  if (!data) return reply({ error: "No document" }, 400);
  if (data.length > 30_000_000) return reply({ error: "That file is too big (max about 20 MB)." }, 413);
  const isPdf = /pdf/.test(mediaType);
  const imgType = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType) ? mediaType : "";
  if (!isPdf && !imgType) return reply({ error: "Send a picture (JPG / PNG) or a PDF." }, 400);

  const client = new Anthropic({ apiKey: key });
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: SCAN_SCHEMA } },
      system: [{ type: "text", text: SCAN_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: [
          isPdf
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
            : { type: "image", source: { type: "base64", media_type: imgType as "image/png", data } },
          { type: "text", text: `TODAY: ${String(body.today || "").slice(0, 10)}\nFILE NAME: ${String(body.name || "").slice(0, 200)}\nRead this document.` },
        ],
      }],
    });
    const after = await usageNow();
    await putRow("ai_usage", { month: after.month, cost: after.cost + costOf(res.usage, MODEL), calls: after.calls + 1 });
    if (res.stop_reason === "refusal") return reply({ error: "The assistant couldn't read that one. File it by hand." });
    const out = res.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") return reply({ error: "No answer" }, 502);
    return reply({ ...JSON.parse(out.text), cost: costOf(res.usage, MODEL) });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return reply({ error: "The assistant's key isn't working (check ANTHROPIC_API_KEY)." }, 500);
    if (err instanceof Anthropic.RateLimitError) return reply({ error: "The assistant is busy, try again in a moment." }, 429);
    if (err instanceof Anthropic.APIError) return reply({ error: `Assistant error ${err.status}` }, 502);
    return reply({ error: "Assistant error" }, 500);
  }
});
