import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";
import nodemailer from "npm:nodemailer@^6.9.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2022-11-15",
  httpClient: Stripe.createFetchHttpClient(),
});

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const gmailUser = Deno.env.get("GMAIL_USER") ?? "";
const gmailPass = Deno.env.get("GMAIL_PASS") ?? "";

// Public URL for your logo hosted on Vercel
const LOGO_URL = "https://cultivar-website.vercel.app/assets/logo.png";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: gmailUser,
    pass: gmailPass,
  },
});

serve(async (req: Request) => {
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  try {
    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      endpointSecret,
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const metadata = session.metadata || {};

      const studentEmail =
        session.customer_details?.email ||
        metadata.studentEmail ||
        metadata.student_email;
      const studentName =
        session.customer_details?.name ||
        metadata.studentName ||
        metadata.student_name ||
        "Student";
      const studentFirstName = studentName.split(" ")[0];

      const tutorEmail = metadata.tutorEmail || metadata.tutor_email;
      const tutorName = metadata.tutorName || metadata.tutor_name || "Tutor";
      const tutorFirstName = tutorName.split(" ")[0];

      const subjectName = metadata.subject || "Tutoring Session";
      const sessionDate =
        metadata.date ||
        metadata.session_date ||
        metadata.sessionDate ||
        "Scheduled Date";
      const sessionTime =
        metadata.time ||
        metadata.session_time ||
        metadata.sessionTime ||
        "Scheduled Time";

      // 1. Send confirmation email to Student
      if (studentEmail) {
        const studentHtmlContent = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px;">
            <p>Hi ${studentFirstName},</p>
            <p>Your tutoring session is confirmed!</p>
            <p>
              <strong>Tutor:</strong> ${tutorName}<br>
              <strong>Subject:</strong> ${subjectName}<br>
              <strong>Date:</strong> ${sessionDate}<br>
              <strong>Time:</strong> ${sessionTime}
            </p>
            <p>Your tutor will contact you by email with the Zoom link for your session.</p>
            <p>Please keep an eye on your inbox before your scheduled time.</p>
            <p>We’re looking forward to your session!</p>
            <p><strong>Cultivar</strong></p>
            <div style="margin-top: 20px;">
              <img src="${LOGO_URL}" alt="cultivar+" style="height: 40px; width: auto;" />
            </div>
          </div>
        `;

        await transporter.sendMail({
          from: `"Cultivar" <${gmailUser}>`,
          to: studentEmail,
          subject: "Your Tutoring Session is Confirmed - Cultivar",
          html: studentHtmlContent,
        });
        console.log(`Student email sent to ${studentEmail}`);
      }

      // 2. Send notification email to Tutor
      if (tutorEmail) {
        const tutorHtmlContent = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px;">
            <p>Hi ${tutorFirstName},</p>
            <p>You have a new tutoring session booked.</p>
            <p>
              <strong>Student:</strong> ${studentName}<br>
              <strong>Subject:</strong> ${subjectName}<br>
              <strong>Date:</strong> ${sessionDate}<br>
              <strong>Time:</strong> ${sessionTime}
            </p>
            <p>Please email the student at <a href="mailto:${studentEmail}">${studentEmail}</a> before the session and send them your Zoom link.</p>
            <p>Make sure to double-check the date and time and arrive prepared for the session.</p>
            <p>If there are any issues with the booking, please contact us as soon as possible.</p>
            <p>Thanks,<br><strong>Cultivar</strong></p>
            <div style="margin-top: 20px;">
              <img src="${LOGO_URL}" alt="cultivar+" style="height: 40px; width: auto;" />
            </div>
          </div>
        `;

        await transporter.sendMail({
          from: `"Cultivar" <${gmailUser}>`,
          to: tutorEmail,
          subject: "New Session Booked - Cultivar",
          html: tutorHtmlContent,
        });
        console.log(`Tutor email sent to ${tutorEmail}`);
      } else {
        console.warn(
          "Warning: tutorEmail metadata missing. Skipped sending tutor email.",
        );
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    console.error("Webhook processing error:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }
});
