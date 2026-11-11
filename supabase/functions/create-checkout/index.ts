// Creates a Stripe Checkout page with the price built on the fly (so every tutor can have a different rate),
// and verifies a finished payment with Stripe.
// Deploy: npx supabase functions deploy create-checkout --no-verify-jwt
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const TEST = KEY.startsWith("sk_test_"); // browser-set prices are ONLY accepted with a test key
const stripe = new Stripe(KEY || "sk_missing", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});
const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "";

const allowed = (o: string | null) =>
  !!o &&
  (o === SITE_ORIGIN ||
    (TEST && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)));
const base = (o: string | null, path: unknown) =>
  allowed(o) && typeof path === "string" && /^\/[\w\-./]*$/.test(path)
    ? o + path
    : SITE_URL + "/";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const cors = {
    "Access-Control-Allow-Origin": allowed(origin) ? origin! : SITE_ORIGIN,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const missing = ["STRIPE_SECRET_KEY", "SITE_URL", "SITE_ORIGIN"].filter(
    (k) => !Deno.env.get(k),
  );
  if (missing.length)
    return json(
      { error: "Missing Supabase secret(s): " + missing.join(", ") },
      500,
    );

  try {
    const body = await req.json();

    // 1) Ask Stripe whether a Checkout Session was really paid
    if (body.action === "verify") {
      const s = await stripe.checkout.sessions.retrieve(
        String(body.session_id),
      );
      return json({
        paid: s.payment_status === "paid",
        ref: s.metadata?.ref ?? null,
        amount_cents: s.amount_total,
      });
    }

    // 2) Create a Checkout Session
    let cents: number,
      tutorName: string,
      tutorEmail: string,
      studentName: string,
      subject: string,
      sessionDate: string,
      sessionTime: string,
      ref: string,
      email: string | undefined,
      desc: string,
      meta: Record<string, string>;

    if (body.booking_id) {
      // Secure path (Supabase bookings)
      const auth = req.headers.get("Authorization") ?? "";
      const url = Deno.env.get("SUPABASE_URL")!;
      const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } },
      });
      const admin = createClient(
        url,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: b, error } = await asUser
        .from("bookings")
        .select("*")
        .eq("id", body.booking_id)
        .single();
      if (error || !b) throw new Error("Booking not found");
      if (b.payment_status === "paid")
        throw new Error("This booking is already paid");
      const { data: t } = await admin
        .from("profiles")
        .select("name, email, rate")
        .eq("id", b.tutor_id)
        .single();
      const { data: s } = await admin
        .from("settings")
        .select("default_rate")
        .single();
      const hours =
        (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) /
        36e5;
      cents = Math.round(Number(t!.rate ?? s!.default_rate) * hours * 100);
      const { data: u } = await admin.auth.getUser(auth.replace("Bearer ", ""));

      tutorName = t!.name;
      tutorEmail = t!.email ?? "";
      studentName =
        u.user?.user_metadata?.full_name ?? u.user?.email ?? "Student";
      subject = b.subject ?? "Tutoring";
      sessionDate = new Date(b.starts_at).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      sessionTime = new Date(b.starts_at).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      ref = b.ref;
      email = u.user?.email;
      desc = `Booking ${b.ref}`;

      meta = {
        booking_id: b.id,
        ref: b.ref,
        // Standard snake_case
        tutor_name: tutorName,
        tutor_email: tutorEmail,
        student_name: studentName,
        student_email: email ?? "",
        subject,
        session_date: sessionDate,
        session_time: sessionTime,
        // Explicit camelCase for stripe-webhook compatibility
        tutorEmail: tutorEmail,
        tutorName: tutorName,
        studentEmail: email ?? "",
        studentName: studentName,
        date: sessionDate,
        time: sessionTime,
      };
      await admin
        .from("bookings")
        .update({ amount_cents: cents })
        .eq("id", b.id);
    } else {
      // Test-mode path (client browser-set details)
      if (!TEST)
        throw new Error(
          "Browser-set prices are only allowed in Stripe test mode. Use a booking_id.",
        );
      cents = Number(body.amount_cents);
      if (!Number.isInteger(cents) || cents < 100 || cents > 100000)
        throw new Error("Invalid amount");
      ref = String(body.ref ?? "");
      if (!/^CV-[A-Z0-9]{4,10}$/.test(ref))
        throw new Error("Invalid booking reference");

      tutorName = String(
        body.tutor_name ?? body.tutorName ?? "your tutor",
      ).slice(0, 100);
      tutorEmail = String(
        body.tutor_email ??
          body.tutorEmail ??
          (body.metadata?.tutorEmail || ""),
      ).slice(0, 100);
      studentName = String(
        body.student_name ?? body.studentName ?? "Student",
      ).slice(0, 100);
      subject = String(body.subject ?? "Tutoring").slice(0, 80);
      sessionDate = String(
        body.session_date ?? body.sessionDate ?? body.when ?? "",
      ).slice(0, 60);
      sessionTime = String(body.session_time ?? body.sessionTime ?? "").slice(
        0,
        60,
      );
      email = /^\S+@\S+\.\S+$/.test(
        String(body.email ?? body.studentEmail ?? ""),
      )
        ? String(body.email ?? body.studentEmail)
        : undefined;
      desc = `${subject} · ${sessionDate} · ${ref}`;

      meta = {
        ref,
        // Standard snake_case
        tutor_name: tutorName,
        tutor_email: tutorEmail,
        student_name: studentName,
        student_email: email ?? "",
        subject,
        session_date: sessionDate,
        session_time: sessionTime,
        // Explicit camelCase & fallback properties for stripe-webhook
        tutorEmail: tutorEmail,
        tutorName: tutorName,
        studentEmail: email ?? "",
        studentName: studentName,
        date: sessionDate,
        time: sessionTime,
      };
    }

    const b0 = base(origin, body.path);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      client_reference_id: ref,
      metadata: meta,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "cad",
            unit_amount: cents,
            product_data: {
              name: `Tutoring session with ${tutorName}`,
              description: desc,
            },
          },
        },
      ],
      success_url: `${b0}?cs={CHECKOUT_SESSION_ID}#paid`,
      cancel_url: `${b0}#account`,
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
});
