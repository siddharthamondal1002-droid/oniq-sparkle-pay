// Fetch TURN credentials from Metered and return { iceServers }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_MS = 30 * 60 * 1000;
let cache: { at: number; servers: unknown[]; app: string } | null = null;

async function tryFetch(app: string, apiKey: string): Promise<unknown[] | null> {
  const url = `https://${app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    if (Array.isArray(j) && j.length > 0) return j;
    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!req.headers.get("authorization")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("METERED_TURN_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "missing METERED_TURN_API_KEY" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return new Response(JSON.stringify({ iceServers: cache.servers, cached: true, app: cache.app }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const explicit = Deno.env.get("METERED_TURN_APP_NAME");
  const candidates = explicit ? [explicit] : ["oniq", "oniqhub", "oniqapp"];

  for (const app of candidates) {
    const servers = await tryFetch(app, apiKey);
    if (servers) {
      cache = { at: Date.now(), servers, app };
      return new Response(JSON.stringify({ iceServers: servers, app }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(
    JSON.stringify({
      error: "no metered subdomain matched",
      tried: candidates,
      hint: "set METERED_TURN_APP_NAME to your Metered app subdomain",
    }),
    { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
