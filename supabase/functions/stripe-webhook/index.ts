// Stripe -> Supabase webhook. This is the authoritative way a booking becomes "paid",
// so it works even if the customer closes the tab before returning to your site.
//
// Deploy WITHOUT JWT verification (Stripe doesn't send one; we verify Stripe's signature):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets needed: STRIPE_WEBHOOK_SECRET  (optional: CURRENCY=cad)
// Stripe Dashboard -> Developers -> Webhooks -> add endpoint:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//   events: checkout.session.completed, checkout.session.async_payment_succeeded
import { createClient } from "npm:@supabase/supabase-js@2";

// ---- shared helpers (inlined so this function is self-contained) ----
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
const EXTRA = (Deno.env.get("EXTRA_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const ALLOWED = [SITE_URL, ...EXTRA].filter(Boolean);

/** CORS: only reflect origins you've allowed (SITE_URL + optional EXTRA_ORIGINS, e.g. http://localhost:5500). */
function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED.includes(origin.replace(/\/+$/, ""));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : SITE_URL || "null",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Service-role client: bypasses RLS. Never expose this key to the browser. */
const adminClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

/** Verify the caller's access token and return their user (or null). */
async function getCaller(req: Request, admin = adminClient()) {
  const token = (req.headers.get("Authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}
// ---- end helpers ----

const SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const CURRENCY = (Deno.env.get("CURRENCY") ?? "cad").toLowerCase();

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function validSignature(
  payload: string,
  header: string,
  tolerance = 300,
) {
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") t = v;
    if (k === "v1") v1.push(v);
  }
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > tolerance)
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${t}.${payload}`),
    ),
  );
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1.some((sig) => safeEqual(sig, hex));
}

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  if (!SECRET) return new Response("Webhook not configured", { status: 500 });

  const payload = await req.text();
  if (
    !(await validSignature(payload, req.headers.get("stripe-signature") ?? ""))
  ) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const s = event.data?.object ?? {};
    if (s.payment_status === "paid") {
      const admin = adminClient();
      const ref = String(s.client_reference_id ?? s.metadata?.ref ?? "");
      const { data: b } = await admin
        .from("bookings")
        .select("id, amount, paid")
        .eq("id", ref)
        .maybeSingle();
      if (
        b &&
        b.paid !== "paid" &&
        s.amount_total === Math.round(Number(b.amount) * 100) &&
        String(s.currency).toLowerCase() === CURRENCY
      ) {
        const { error } = await admin
          .from("bookings")
          .update({ paid: "paid" })
          .eq("id", b.id);
        if (error) {
          console.error(error);
          return new Response("DB error", { status: 500 });
        } // Stripe will retry
      } else if (b && b.paid !== "paid") {
        console.error(
          "Amount/currency mismatch for",
          ref,
          s.amount_total,
          s.currency,
        );
      }
    }
  }
  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
