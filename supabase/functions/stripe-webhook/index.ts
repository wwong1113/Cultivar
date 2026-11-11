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
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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

// ---- email notifications (sent from your Gmail after a payment is confirmed) ----
// Needs secrets: GMAIL_USER, GMAIL_APP_PASSWORD. Each email is "claimed" in the database
// first, so the tutor and student each get exactly one, even if both the webhook and the
// return-from-Stripe check confirm the same payment.
const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
const fixSpaces = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");
const fmtDate = (iso: string, tz: string) =>
  fixSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      dateStyle: "full",
    }).format(new Date(iso)),
  );
const fmtTime = (iso: string, tz: string) =>
  fixSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso)),
  );

const escHtml = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
// The logo shown at the bottom of every email. Upload assets/email-logo.png to your website
// (so it is reachable at this address), or set the LOGO_URL secret to point somewhere else.
const LOGO_URL =
  Deno.env.get("LOGO_URL") ??
  "https://cultivar-website.vercel.app/assets/email-logo.png";
// Wraps the email lines in simple, email-safe HTML and puts the logo at the bottom.
const emailHtml = (paragraphs: string[]) =>
  `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111111;max-width:560px">` +
  paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join("") +
  `<img src="${escHtml(LOGO_URL)}" alt="Cultivar+" width="240" style="display:block;border:0;width:240px;max-width:100%;height:auto;margin-top:8px"></div>`;

// returns true when done or intentionally skipped, false if an email failed to send (worth retrying)
async function notifyBooking(admin: any, bookingId: string): Promise<boolean> {
  const user = (Deno.env.get("GMAIL_USER") ?? "").trim();
  const pass = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
  if (!user || !pass) {
    console.error(
      "Booking emails skipped: set the GMAIL_USER and GMAIL_APP_PASSWORD secrets.",
    );
    return true;
  }
  const { data: b } = await admin
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  if (!b || b.paid !== "paid") return true;

  let tutorEmail = "";
  if (b.tutor_id) {
    const { data: t } = await admin
      .from("profiles")
      .select("email")
      .eq("id", b.tutor_id)
      .maybeSingle();
    tutorEmail = clean(t?.email);
  }
  const date = fmtDate(b.start_at, b.tz),
    time = fmtTime(b.start_at, b.tz);
  const studentName = clean(b.student_name),
    tutorName = clean(b.tutor_name),
    subject = clean(b.subject);

  const tutorText = [
    "Hi Tutor,",
    "",
    "You have a new tutoring session booked.",
    "",
    `Student: ${studentName}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Time: ${time}`,
    "",
    `Please email the student at ${clean(b.student_email)} before the session and send them your Zoom link.`,
    "",
    "Make sure to double-check the date and time and arrive prepared for the session.",
    "",
    "If there are any issues with the booking, please contact us as soon as possible.",
    "",
    "Thanks,",
    "Cultivar",
  ].join("\n");

  const studentText = [
    `Hi ${studentName},`,
    "",
    "Your tutoring session is confirmed!",
    "",
    `Tutor: ${tutorName}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Time: ${time}`,
    "",
    "Your tutor will contact you by email with the Zoom link for your session.",
    "",
    "Please keep an eye on your inbox before your scheduled time.",
    "",
    "We’re looking forward to your session!",
    "",
    "Cultivar",
  ].join("\n");

  const e = escHtml;
  const tutorHtml = emailHtml([
    "Hi Tutor,",
    "You have a new tutoring session booked.",
    `Student: ${e(studentName)}<br>Subject: ${e(subject)}<br>Date: ${e(date)}<br>Time: ${e(time)}`,
    `Please email the student at <a href="mailto:${e(clean(b.student_email))}" style="color:#111111">${e(clean(b.student_email))}</a> before the session and send them your Zoom link.`,
    "Make sure to double-check the date and time and arrive prepared for the session.",
    "If there are any issues with the booking, please contact us as soon as possible.",
    "Thanks,<br>Cultivar",
  ]);
  const studentHtml = emailHtml([
    `Hi ${e(studentName)},`,
    "Your tutoring session is confirmed!",
    `Tutor: ${e(tutorName)}<br>Subject: ${e(subject)}<br>Date: ${e(date)}<br>Time: ${e(time)}`,
    "Your tutor will contact you by email with the Zoom link for your session.",
    "Please keep an eye on your inbox before your scheduled time.",
    "We’re looking forward to your session!",
    "Cultivar",
  ]);

  const claim = async (col: string) => {
    const { data } = await admin
      .from("bookings")
      .update({ [col]: new Date().toISOString() })
      .eq("id", b.id)
      .is(col, null)
      .select("id");
    return !!data?.length;
  };
  const release = (col: string) =>
    admin
      .from("bookings")
      .update({ [col]: null })
      .eq("id", b.id);

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: user, password: pass },
    },
  });
  let allOk = true;
  const send = async (
    col: string,
    to: string,
    subjectLine: string,
    content: string,
    html: string,
  ) => {
    if (!to || !(await claim(col))) return; // nothing to send, or already sent
    try {
      await client.send({
        from: `Cultivar <${user}>`,
        to,
        subject: subjectLine,
        content,
        html,
      });
    } catch (e) {
      console.error(`Email to ${col} failed:`, e);
      await release(col); // lets a retry send it
      allOk = false;
    }
  };
  try {
    await send(
      "tutor_emailed_at",
      tutorEmail,
      "New tutoring session booked",
      tutorText,
      tutorHtml,
    );
    await send(
      "student_emailed_at",
      clean(b.student_email),
      "Your tutoring session is confirmed",
      studentText,
      studentHtml,
    );
  } finally {
    try {
      await client.close();
    } catch (_) {
      /* ignore */
    }
  }
  return allOk;
}
// ---- end email notifications ----

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
      if (b) {
        const valid =
          s.amount_total === Math.round(Number(b.amount) * 100) &&
          String(s.currency).toLowerCase() === CURRENCY;
        if (!valid) {
          if (b.paid !== "paid")
            console.error(
              "Amount/currency mismatch for",
              ref,
              s.amount_total,
              s.currency,
            );
        } else {
          if (b.paid !== "paid") {
            const { error } = await admin
              .from("bookings")
              .update({ paid: "paid" })
              .eq("id", b.id);
            if (error) {
              console.error(error);
              return new Response("DB error", { status: 500 });
            } // Stripe will retry
          }
          // send the tutor/student emails (once). If sending fails, ask Stripe to retry later.
          const emailed = await notifyBooking(admin, b.id).catch((e) => {
            console.error("notify error", e);
            return false;
          });
          if (!emailed) return new Response("Email error", { status: 500 });
        }
      }
    }
  }
  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
