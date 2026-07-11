// TURN credentials for WebRTC calls.
// Uses Metered.ca free TURN when METERED_API_KEY is set; falls back to Google STUN.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const FALLBACK = [{ urls: "stun:stun.l.google.com:19302" }];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const key = Deno.env.get("METERED_API_KEY");
  let iceServers: unknown[] = FALLBACK;
  let source = "stun-fallback";
  if (key) {
    try {
      const r = await fetch(
        `https://oniq.metered.ca/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`,
      );
      if (r.ok) {
        const arr = await r.json();
        if (Array.isArray(arr) && arr.length > 0) {
          iceServers = arr;
          source = "metered";
        }
      }
    } catch (_e) {
      // fall through to STUN
    }
  }
  return new Response(JSON.stringify({ iceServers, source }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
