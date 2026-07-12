// TURN credentials for WebRTC calls.
// Prefers Metered.ca dynamic creds (METERED_TURN_API_KEY / METERED_API_KEY);
// always falls back to STUN + OpenRelay static TURN so strict/symmetric-NAT
// networks still get a relay path.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const OPENRELAY_FALLBACK: unknown[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const key = Deno.env.get("METERED_TURN_API_KEY") ?? Deno.env.get("METERED_API_KEY");
  let iceServers: unknown[] = OPENRELAY_FALLBACK;
  let source = "openrelay-fallback";
  if (key) {
    try {
      const r = await fetch(
        `https://oniqhub.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`,
      );
      if (r.ok) {
        const arr = await r.json();
        if (Array.isArray(arr) && arr.length > 0) {
          // Merge Metered creds with OpenRelay as a secondary relay path.
          iceServers = [...arr, ...OPENRELAY_FALLBACK];
          source = "metered+openrelay";
        }
      } else {
        console.warn("turn-creds: metered http", r.status);
      }
    } catch (e) {
      console.warn("turn-creds: metered fetch failed", e);
    }
  }
  const relayCount = iceServers.filter((s: any) => {
    const u = s?.urls;
    const arr = Array.isArray(u) ? u : [u];
    return arr.some((x: string) => typeof x === "string" && x.startsWith("turn:"));
  }).length;
  console.log(`turn-creds: source=${source} servers=${iceServers.length} relay=${relayCount} keyPresent=${!!key}`);
  return new Response(JSON.stringify({ iceServers, source, relayCount }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
