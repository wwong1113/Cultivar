// Shared helpers for the Cultivar+ Edge Functions.
import { createClient } from "npm:@supabase/supabase-js@2";

export const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
const EXTRA = (Deno.env.get("EXTRA_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const ALLOWED = [SITE_URL, ...EXTRA].filter(Boolean);

/** CORS: only reflect origins you've allowed (SITE_URL + optional EXTRA_ORIGINS, e.g. http://localhost:5500). */
export function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED.includes(origin.replace(/\/+$/, ""));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : SITE_URL || "null",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(
  headers: Record<string, string>,
  body: unknown,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** Service-role client: bypasses RLS. Never expose this key to the browser. */
export const adminClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

/** Verify the caller's access token and return their user (or null). */
export async function getCaller(req: Request, admin = adminClient()) {
  const token = (req.headers.get("Authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}
