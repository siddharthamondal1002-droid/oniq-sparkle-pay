import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Google Maps Static API — a route as a picture, for Rides.
//
// SAME KEY, NOT A NEW ONE. Rides already runs Google Places (New) on
// GOOGLE_MAPS_API_KEY through places.functions.ts. This is a second endpoint
// on the same Maps Platform key and the same account — not a new provider
// choice, so it does not reopen the question CLAUDE.md's business-decision
// rule is about. There is no Maps JavaScript API here and no browser-side
// key: the request is server-side, exactly like placesAutocomplete/
// placeDetails, and the client gets back finished PNG bytes, never the key.
//
// POST/GET-VERIFIED before being written down (2026-09-04, via the Lovable
// agent, on the live GOOGLE_MAPS_API_KEY): staticmap answered 200
// image/png (158,944 bytes, real PNG magic 89 50 4E 47) for exactly the
// request shape below, with only the coordinates changed per call.
//
// Callers must treat any thrown error as a signal to render no map rather
// than fail the ride flow — a picture of the route is a nice-to-have next to
// actually booking a ride, never a blocker for it.

export type MapPoint = { lat: number; lon: number };

const MAX_DIMENSION = 640;
const SCALE = 2;

function clampFinite(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export const staticRouteMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pickup: MapPoint; destination: MapPoint }) => d)
  .handler(async ({ data }): Promise<{ dataUrl: string }> => {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY not configured");

    const { pickup, destination } = data;
    for (const p of [pickup, destination]) {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
        throw new Error("pickup and destination need real coordinates");
      }
    }

    const w = clampFinite(MAX_DIMENSION, 200, 640);
    const h = clampFinite(320, 200, 640);
    const params = new URLSearchParams({
      size: `${w}x${h}`,
      scale: String(SCALE),
      maptype: "roadmap",
      key,
    });
    // Same measured shape as the probe: one green marker (pickup), one red
    // marker (destination), one path between them.
    params.append("markers", `color:green|${pickup.lat},${pickup.lon}`);
    params.append("markers", `color:red|${destination.lat},${destination.lon}`);
    params.append(
      "path",
      `color:0x1e90ff|weight:4|${pickup.lat},${pickup.lon}|${destination.lat},${destination.lon}`,
    );

    const res = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // Google's error body may name the key — never let it reach the client.
      throw new Error(`Static map request failed (${res.status})`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    // Sniffed, not assumed: this endpoint has answered a JSON error with a
    // 200 status before for other Maps Platform surfaces, so the magic bytes
    // are the real check that this is a picture and not text pretending.
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) {
      throw new Error("Static map did not return an image");
    }
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    }
    return { dataUrl: `data:image/png;base64,${btoa(binary)}` };
  });
