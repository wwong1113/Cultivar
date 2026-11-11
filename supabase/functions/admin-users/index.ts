// Admin-only user management: create / update / suspend / reset password / delete.
// These need the service-role key, so they can never run in the browser.
// The caller must be logged in AND listed in the public.admins table.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^\S+@\S+\.\S+$/;
const strList = (v: unknown, max: number) =>
  Array.isArray(v)
    ? v
        .map((x) => String(x).trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, max)
    : [];

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return json(cors, { error: "Method not allowed" }, 405);

  try {
    const admin = adminClient();
    const caller = await getCaller(req, admin);
    if (!caller) return json(cors, { error: "Please log in again." }, 401);
    const { data: isAdmin } = await admin
      .from("admins")
      .select("id")
      .eq("id", caller.id)
      .maybeSingle();
    if (!isAdmin) return json(cors, { error: "Not allowed." }, 403);

    const b = await req.json().catch(() => ({}));
    const id = String(b.id ?? "");

    // ------------------------------------------------------------ create
    if (b.action === "create") {
      const role = b.role === "tutor" ? "tutor" : "student";
      const email = String(b.email ?? "")
        .trim()
        .toLowerCase();
      const password = String(b.password ?? "");
      if (!EMAIL.test(email))
        return json(cors, { error: "Enter a valid email." }, 400);
      if (password.length < 8)
        return json(
          cors,
          { error: "Temporary password must be 8+ characters." },
          400,
        );

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role,
          name: String(b.name ?? "")
            .trim()
            .slice(0, 100),
          grade: b.grade,
          uni: b.uni,
          program: b.program,
          subjects: strList(b.subjects, 15),
          vibe: strList(b.vibe, 12),
          bio: b.bio,
          pay_link: b.pay_link,
        },
      });
      if (error) return json(cors, { error: error.message }, 400);
      if (
        role === "tutor" &&
        b.rate !== undefined &&
        b.rate !== null &&
        b.rate !== ""
      ) {
        await admin
          .from("profiles")
          .update({ rate: Number(b.rate) })
          .eq("id", data.user.id);
      }
      return json(cors, { id: data.user.id });
    }

    if (!UUID.test(id)) return json(cors, { error: "Bad user id." }, 400);
    if (id === caller.id)
      return json(
        cors,
        { error: "You can't do that to your own admin account." },
        400,
      );

    // ------------------------------------------------------------ update
    if (b.action === "update") {
      const patch: Record<string, unknown> = {};
      if ("name" in b) patch.name = String(b.name).trim().slice(0, 100);
      if ("grade" in b) patch.grade = b.grade === null ? null : Number(b.grade);
      if ("uni" in b)
        patch.uni = String(b.uni ?? "")
          .trim()
          .slice(0, 120);
      if ("program" in b)
        patch.program = String(b.program ?? "")
          .trim()
          .slice(0, 120);
      if ("bio" in b)
        patch.bio = String(b.bio ?? "")
          .trim()
          .slice(0, 400);
      if ("subjects" in b) patch.subjects = strList(b.subjects, 15);
      if ("vibe" in b) patch.vibe = strList(b.vibe, 12);
      if ("pay_link" in b)
        patch.pay_link = b.pay_link ? String(b.pay_link).trim() : null;
      if ("photo" in b) patch.photo = b.photo ? String(b.photo) : null;
      if ("rate" in b)
        patch.rate = b.rate === null || b.rate === "" ? null : Number(b.rate);
      if (b.email) {
        const email = String(b.email).trim().toLowerCase();
        if (!EMAIL.test(email))
          return json(cors, { error: "Enter a valid email." }, 400);
        const { error } = await admin.auth.admin.updateUserById(id, {
          email,
          email_confirm: true,
        });
        if (error) return json(cors, { error: error.message }, 400);
        patch.email = email;
      }
      const { error } = await admin.from("profiles").update(patch).eq("id", id);
      if (error) return json(cors, { error: error.message }, 400);
      return json(cors, { ok: true });
    }

    // ------------------------------------------------------------ suspend / activate
    if (b.action === "set_status") {
      const status = b.status === "suspended" ? "suspended" : "active";
      // "ban" also blocks logins, so suspension is enforced by Auth itself.
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: status === "suspended" ? "876000h" : "none",
      });
      if (error) return json(cors, { error: error.message }, 400);
      const { error: e2 } = await admin
        .from("profiles")
        .update({ status })
        .eq("id", id);
      if (e2) return json(cors, { error: e2.message }, 400);
      return json(cors, { ok: true });
    }

    // ------------------------------------------------------------ reset password
    if (b.action === "set_password") {
      const password = String(b.password ?? "");
      if (password.length < 8)
        return json(cors, { error: "Password must be 8+ characters." }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json(cors, { error: error.message }, 400);
      return json(cors, { ok: true });
    }

    // ------------------------------------------------------------ delete
    if (b.action === "delete") {
      await admin
        .from("bookings")
        .update({ status: "cancelled" })
        .or(`student_id.eq.${id},tutor_id.eq.${id}`)
        .eq("status", "confirmed")
        .gt("end_at", new Date().toISOString());
      await admin.storage.from("avatars").remove([`${id}/avatar.jpg`]);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json(cors, { error: error.message }, 400);
      return json(cors, { ok: true });
    }

    return json(cors, { error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json(cors, { error: "Something went wrong." }, 500);
  }
});
