// Creates a Stripe Checkout session for a booking and verifies payment on return.
//
// The browser only sends a booking reference. The AMOUNT, tutor, student and
// email all come from your database, so a customer can't change the price.
//
// Secrets needed:  STRIPE_SECRET_KEY, SITE_URL   (optional: CURRENCY=cad, EXTRA_ORIGINS)
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

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const CURRENCY = (Deno.env.get("CURRENCY") ?? "cad").toLowerCase();

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return json(cors, { error: "Method not allowed" }, 405);

  try {
    if (!STRIPE_KEY || !SITE_URL)
      return json(cors, { error: "Payments are not configured yet." }, 500);

    const admin = adminClient();
    const user = await getCaller(req, admin);
    if (!user) return json(cors, { error: "Please log in again." }, 401);

    const body = await req.json().catch(() => ({}));

    // ---------------------------------------------------------- create
    if (body.action === "create") {
      const ref = String(body.ref ?? "");
      const { data: b } = await admin
        .from("bookings")
        .select("*")
        .eq("id", ref)
        .maybeSingle();
      if (!b || b.student_id !== user.id)
        return json(cors, { error: "Booking not found." }, 404);
      if (b.status !== "confirmed" || b.paid !== "unpaid") {
        return json(
          cors,
          { error: "This booking can't be paid right now." },
          409,
        );
      }
      const cents = Math.round(Number(b.amount) * 100);
      if (!(cents >= 50))
        return json(cors, { error: "Amount is too small to charge." }, 400);

      const { data: tutor } = b.tutor_id
        ? await admin
            .from("profiles")
            .select("email")
            .eq("id", b.tutor_id)
            .maybeSingle()
        : { data: null };

      const path =
        typeof body.path === "string" &&
        /^\/[A-Za-z0-9._~\-\/]*$/.test(body.path)
          ? body.path
          : "/";
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: b.tz,
        dateStyle: "full",
      }).format(new Date(b.start_at));
      const time = new Intl.DateTimeFormat("en-CA", {
        timeZone: b.tz,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(b.start_at));

      const p = new URLSearchParams();
      p.set("mode", "payment");
      p.set("client_reference_id", b.id);
      p.set("customer_email", b.student_email);
      p.set("success_url", `${SITE_URL}${path}?cs={CHECKOUT_SESSION_ID}#paid`);
      p.set("cancel_url", `${SITE_URL}${path}#account`);
      p.set("line_items[0][quantity]", "1");
      p.set("line_items[0][price_data][currency]", CURRENCY);
      p.set("line_items[0][price_data][unit_amount]", String(cents));
      p.set(
        "line_items[0][price_data][product_data][name]",
        `Tutoring session with ${b.tutor_name}`,
      );
      p.set(
        "line_items[0][price_data][product_data][description]",
        `${b.subject} · ${date}, ${time}`,
      );
      const meta: Record<string, string> = {
        ref: b.id,
        studentEmail: b.student_email,
        studentName: b.student_name,
        tutorEmail: tutor?.email ?? "",
        tutorName: b.tutor_name,
        subject: b.subject,
        date,
        time,
      };
      for (const [k, v] of Object.entries(meta))
        p.set(`metadata[${k}]`, String(v).slice(0, 500));

      const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: p,
      });
      const s = await r.json();
      if (!r.ok || !s.url) {
        console.error("Stripe create error", JSON.stringify(s));
        return json(cors, { error: "Could not start checkout." }, 502);
      }
      return json(cors, { url: s.url });
    }

    // ---------------------------------------------------------- verify
    if (body.action === "verify") {
      const sid = String(body.session_id ?? "");
      if (!/^cs_[A-Za-z0-9_]+$/.test(sid))
        return json(cors, { error: "Bad session." }, 400);

      const r = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${sid}`,
        {
          headers: { Authorization: `Bearer ${STRIPE_KEY}` },
        },
      );
      const s = await r.json();
      if (!r.ok) return json(cors, { paid: false });

      const ref = String(s.client_reference_id ?? s.metadata?.ref ?? "");
      const { data: b } = await admin
        .from("bookings")
        .select("*")
        .eq("id", ref)
        .maybeSingle();
      if (!b || b.student_id !== user.id)
        return json(cors, { paid: false, error: "Booking not found." }, 404);

      const cents = Math.round(Number(b.amount) * 100);
      const ok =
        s.payment_status === "paid" &&
        s.amount_total === cents &&
        String(s.currency).toLowerCase() === CURRENCY;
      if (ok && b.paid !== "paid")
        await admin.from("bookings").update({ paid: "paid" }).eq("id", b.id);
      if (ok)
        await notifyBooking(admin, b.id).catch((e) =>
          console.error("notify error", e),
        );
      return json(cors, { paid: ok, ref: b.id, amount_cents: s.amount_total });
    }

    return json(cors, { error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json(cors, { error: "Something went wrong." }, 500);
  }
});
