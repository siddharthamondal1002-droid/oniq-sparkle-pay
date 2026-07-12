// Returns MSG91 widget config for the browser. tokenAuth is a widget-scoped
// identifier meant to run client-side inside MSG91's initSendOTP loader —
// safe to return to the page. The DLT-sensitive MSG91_AUTH_KEY stays
// server-only (used in msg91-verify-session).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const widgetId = Deno.env.get("MSG91_WIDGET_ID") ?? "36676c674561353032383837";
  const tokenAuth = Deno.env.get("MSG91_WIDGET_TOKEN") ?? null;
  return new Response(
    JSON.stringify({ widgetId, tokenAuth, ready: !!tokenAuth }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
