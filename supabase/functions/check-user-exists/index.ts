// MSG91 widget "check user existence" API. Called server-to-server by MSG91
// with the identifier (phone or email) as a query param; answers whether an
// ONIQ account exists so the widget can branch login/signup.
//
// Guarded by a static key in the URL (only MSG91 and the ONIQ owner hold the
// full URL) so this cannot be used as a public account-enumeration oracle.
// Lookup runs through the service-role-only public.user_exists() function.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Static URL guard. Secret-only: no hardcoded fallback, fails closed if unset.
const URL_KEY = Deno.env.get("CHECK_USER_KEY") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const url = new URL(req.url);
  if (!URL_KEY) {
    console.error("check-user-exists: CHECK_USER_KEY is not configured");
    return json({ error: "unauthorized" }, 401);
  }
  if (url.searchParams.get("key") !== URL_KEY) {
    return json({ error: "unauthorized" }, 401);
  }

  const identifier = (
    url.searchParams.get("identifier") ??
    url.searchParams.get("mobile") ??
    url.searchParams.get("phone") ??
    url.searchParams.get("email") ??
    ""
  ).trim();
  if (!identifier) return json({ error: "identifier required" }, 400);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await admin.rpc("user_exists", { _identifier: identifier });
    if (error) throw error;
    return json({ user_found: !!data, identifier });
  } catch (err) {
    console.error("check-user-exists failed", err);
    // Fail closed as "not found" with 200 so the widget can still proceed
    // with a signup-style flow rather than hard-erroring the user.
    return json({ user_found: false, identifier, degraded: true });
  }
});
