// Stripe calls this after a payment. It verifies the signature, marks the booking paid, and emails tutor/student.
// Deploy WITHOUT JWT checking: npx supabase functions deploy stripe-webhook --no-verify-jwt
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

async function sendEmail(to: string, subject: string, text: string) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY missing. Email not sent.");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Cultivar <onboarding@resend.dev>",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("Failed to send email via Resend:", errText);
  }
}

async function handleBookingEmails(
  meta: Record<string, string>,
  customerEmail?: string,
) {
  const tutorName = meta.tutor_name || "Tutor";
  const tutorFirstName = tutorName.split(" ")[0];
  const tutorEmail = meta.tutor_email;

  const studentName = meta.student_name || "Student";
  const studentFirstName = studentName.split(" ")[0];
  const studentEmail = meta.student_email || customerEmail;

  const subject = meta.subject || "Tutoring Session";
  const dateStr = meta.session_date || "Scheduled Date";
  const timeStr = meta.session_time || "Scheduled Time";
  const brandName = "cultivar+";

  // 1. Tutor Email
  if (tutorEmail) {
    const tutorText = `Hi ${tutorFirstName},

You have a new tutoring session booked.

Student: ${studentName}
Subject: ${subject}
Date: ${dateStr}
Time: ${timeStr}

Please email the student at ${studentEmail || "[Client Email]"} before the session and send them your Zoom link.

Make sure to double-check the date and time and arrive prepared for the session.

If there are any issues with the booking, please contact us as soon as possible.

Thanks,
${brandName}`;

    await sendEmail(
      tutorEmail,
      `New Session Booked: ${studentName} (${subject})`,
      tutorText,
    );
  }

  // 2. Student Email
  if (studentEmail) {
    const studentText = `Hi ${studentFirstName},

Your tutoring session is confirmed!

Tutor: ${tutorName}
Subject: ${subject}
Date: ${dateStr}
Time: ${timeStr}

Your tutor will contact you by email with the Zoom link for your session.

Please keep an eye on your inbox before your scheduled time.

We’re looking forward to your session!

${brandName}`;

    await sendEmail(
      studentEmail,
      `Booking Confirmed with ${tutorName}!`,
      studentText,
    );
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (e) {
    return new Response(`Webhook error: ${(e as Error).message}`, {
      status: 400,
    });
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.payment_status === "paid") {
      if (s.metadata?.booking_id) {
        await db
          .from("bookings")
          .update({ payment_status: "paid", stripe_session_id: s.id })
          .eq("id", s.metadata.booking_id);
      }
      if (s.metadata) {
        await handleBookingEmails(
          s.metadata,
          s.customer_details?.email ?? s.customer_email ?? undefined,
        );
      }
    }
  }
  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
