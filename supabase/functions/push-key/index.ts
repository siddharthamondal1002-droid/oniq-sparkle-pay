/**
 * The VAPID public key, for browsers about to subscribe.
 *
 * WHY AN ENDPOINT AND NOT A CONSTANT. The key is DERIVED from the single
 * secret the server signs with (VAPID_PRIVATE_KEY, a P-256 private JWK), so
 * there is exactly one source of truth. A copy pasted into the client bundle
 * would be a second one — and the day the key is rotated the two stop
 * matching, which does not raise an error anywhere: `pushManager.subscribe`
 * succeeds against the stale key and every push it produces is silently
 * undeliverable. One derivation, no drift.
 *
 * PUBLIC BY DESIGN. This value ships to every browser as
 * `applicationServerKey`; it is the half of the pair meant to be handed out.
 * No auth is required and none is checked. The private half never leaves the
 * function's environment.
 */
import { parseVapidJwk, vapidPublicKey } from "../_shared/webpush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const raw = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!raw) {
    // Explicit rather than empty: a client that gets `configured:false` can say
    // "notifications aren't set up" instead of retrying a subscribe that will
    // never work.
    return json({ error: "web push is not configured", configured: false }, 503);
  }
  try {
    return json({ publicKey: vapidPublicKey(parseVapidJwk(raw)), configured: true });
  } catch (e) {
    // Never echo the key material, only the shape complaint.
    console.error("push-key: bad VAPID_PRIVATE_KEY —", (e as Error).message);
    return json({ error: "web push key is misconfigured", configured: false }, 503);
  }
});
