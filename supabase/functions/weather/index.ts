// weather — Google Weather, on the Firebase service account.
//
// OWNER DIRECTIVE, 2026-09-04h: "also use Vertex ai through google firebase
// credentials for google weather". The measured evidence that the endpoint
// takes an OAuth 2 token at all — three probes with a control set — is in the
// header of _shared/weatherCore.ts, along with what is still unproven.
//
// WHOSE MONEY. The FIREBASE PROJECT, per the owner's words and by the same
// mechanism Vertex already uses: googleAccessToken() reaches for
// FIREBASE_SERVICE_ACCOUNT under owner directive 2026-09-04e. So one switch —
// GOOGLE_VERTEX_USE_FIREBASE_SA=false — stops both without a deploy, and
// WEATHER_ENABLED=false stops this one alone.
//
// THE GUARDS ARE NOT THE GENERATION GUARDS, and that is deliberate. A weather
// lookup is not a generative call: there is no prompt to refuse, no output to
// label, and the per-call price is small. What it has instead is the worst
// possible SHAPE for a bill — a chip on the Home screen, the most-opened
// surface in the app, once per app open per user. So the guard that matters
// here is not a cap on how much any one person may spend, it is a CACHE that
// makes the bill scale with places and time rather than with people:
//
//     caller gate -> kill switch -> coordinate validation
//       -> SHARED CACHE (one row per ~11 km cell, 15 minutes)
//         -> at most one billable lookup
//
// The cache is in Postgres rather than in module scope on purpose. An edge
// isolate's memory is per-isolate and Supabase runs many; a Map would cut
// repeat calls within one isolate's life and leave every cold start paying
// again. One small table makes the collapse global.
//
// NOTHING IS INVENTED. If the token cannot be minted, or Google answers
// something this cannot read, the reply says so and carries no reading. The
// screen then shows no chip. A temperature is exactly the kind of number that
// looks harmless invented and is a lie on somebody's home screen.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { googleAccessToken } from "../_shared/googleAuth.ts";
import {
  AIR_URL,
  CACHE_TTL_SECONDS,
  airBody,
  cacheKey,
  currentConditionsUrl,
  mapAirQuality,
  mapCurrentConditions,
  snapCoord,
  validCoords,
  type AirNow,
  type WeatherNow,
} from "../_shared/weatherCore.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Unset or any ordinary "yes" is on; anything else is off. */
function enabled(): boolean {
  const raw = (Deno.env.get("WEATHER_ENABLED") ?? "").trim().toLowerCase();
  return raw === "" || raw === "true" || raw === "yes" || raw === "1" || raw === "on";
}

type CacheRow = { reading: WeatherNow; air: AirNow | null; fetched_at: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ---- caller gate ---------------------------------------------------------
  // Re-derived from the JWT rather than trusted from the body, the same shape
  // image-generate and story-deliver use. Weather is cheap, not free.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "Sign in to see the weather" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes } = await asCaller.auth.getUser();
  if (!userRes?.user) return json(401, { error: "Sign in to see the weather" });

  // ---- kill switch ---------------------------------------------------------
  // Before the coordinates are even read, so turning it off costs nothing.
  if (!enabled()) return json(200, { configured: false, reason: "weather is switched off" });

  let body: { lat?: unknown; lon?: unknown; language?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const at = validCoords(body.lat, body.lon);
  if (!at) return json(400, { error: "A latitude and longitude are required" });
  const language =
    typeof body.language === "string" && /^[a-z-]{2,8}$/i.test(body.language)
      ? body.language
      : "en";

  const key = cacheKey(at.lat, at.lon);

  // ---- the cache, which is the cost control -------------------------------
  const freshAfter = new Date(Date.now() - CACHE_TTL_SECONDS * 1000).toISOString();
  const { data: hit, error: cacheError } = await admin
    .from("weather_cache")
    .select("reading, air, fetched_at")
    .eq("cell", key)
    .gte("fetched_at", freshAfter)
    .maybeSingle();
  // A CACHE THAT CANNOT BE READ IS A BILL, NOT A BUG, and it would be silent.
  // Discarding this error is the version of this function that was nearly
  // deployed: if the table is missing — the migration not applied yet, the
  // commonest case, since a function can deploy before its migration — every
  // request falls through to TWO metered Google calls, forever, and the only
  // symptom is the invoice. Serving is still right (refusing to show the
  // weather because a cache is missing trades a working feature for a saving),
  // but it must never be quiet about it.
  if (cacheError) {
    console.error(
      "[weather] CACHE UNAVAILABLE — every request is now a billable lookup:",
      cacheError.message,
    );
  }
  if (hit) {
    const row = hit as CacheRow;
    return json(200, {
      configured: true,
      cached: true,
      now: row.reading,
      air: row.air ?? null,
      fetchedAt: row.fetched_at,
    });
  }

  // ---- the credential ------------------------------------------------------
  const token = await googleAccessToken();
  if (!token.ok) {
    // The reason names which SECRET is missing, never a value — googleAuth
    // builds it that way. An operator reading a log needs the next step.
    console.error("[weather] no google token:", token.reason);
    return json(200, { configured: false, reason: token.reason });
  }

  // ---- one billable lookup -------------------------------------------------
  // THE CACHE KEY'S CELL CENTRE, not the caller's exact position. Two reasons,
  // and both matter: the answer has to be the one that gets stored under this
  // key, and a person's precise coordinates then never leave ONIQ for Google.
  const cell = { lat: snapCoord(at.lat), lon: snapCoord(at.lon) };
  const auth = {
    authorization: `Bearer ${token.token}`,
    // The same project header Vertex needs; it is what tells Google which
    // project's quota and bill this call belongs to.
    "x-goog-user-project": token.projectId,
  };

  // BOTH LOOKUPS AT ONCE, and the air one is allowed to fail on its own.
  //
  // Owner directive 2026-09-04i added air quality; it is a SECOND metered API
  // (airquality.googleapis.com), so it doubles the per-miss cost and changes
  // nothing about the per-hit cost — the cache row holds both readings, so a
  // cell still costs one round of calls per quarter hour however many people
  // open the app.
  //
  // In parallel because they are independent and a person waiting on the Home
  // screen should wait for the slower of the two, not for their sum. And the
  // air result is settled SEPARATELY: air quality is the newer, more likely to
  // be unenabled of the two APIs, and losing the temperature because the air
  // index was unavailable would be trading a working feature for a missing one.
  let res: Response;
  let airRes: Response | null = null;
  try {
    [res, airRes] = await Promise.all([
      fetch(currentConditionsUrl(cell.lat, cell.lon, language), { headers: auth }),
      // A POST with a JSON body — measured; weather is a GET. See weatherCore.
      fetch(AIR_URL, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify(airBody(cell.lat, cell.lon, language)),
      }).catch(() => null),
    ]);
  } catch {
    return json(200, { configured: true, unavailable: true, reason: "could not reach Google" });
  }

  // Read, but never let it take the weather down with it.
  let air: AirNow | null = null;
  if (airRes) {
    const airRaw = await airRes.json().catch(() => null);
    if (airRes.ok) {
      air = mapAirQuality(airRaw);
      if (!air) console.error("[weather] unreadable air response shape");
    } else {
      const m = (airRaw as { error?: { message?: unknown } } | null)?.error?.message;
      console.error("[weather] air lookup failed:", airRes.status, m ?? `http ${airRes.status}`);
    }
  }

  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    // Google's own words, which separate "this project has not enabled the
    // Weather API" from "this service account may not call it" from "billing
    // is off" — three different next steps that a generic failure would blur.
    const message =
      (raw as { error?: { message?: unknown } } | null)?.error?.message ?? `http ${res.status}`;
    console.error("[weather] lookup failed:", res.status, message);
    return json(200, {
      configured: true,
      unavailable: true,
      reason: typeof message === "string" ? message : `http ${res.status}`,
    });
  }

  const now = mapCurrentConditions(raw);
  if (!now) {
    console.error("[weather] unreadable response shape");
    return json(200, { configured: true, unavailable: true, reason: "unreadable response" });
  }

  // Written after the reading is known good, so a bad shape cannot be cached
  // and served for the next fifteen minutes.
  const { error: upsertError } = await admin
    .from("weather_cache")
    .upsert(
      { cell: key, reading: now, air, fetched_at: new Date().toISOString() },
      { onConflict: "cell" },
    );
  // A cache that cannot be written is a cost problem, not a correctness one —
  // the reading is still good, so it is served and the failure is logged.
  if (upsertError) console.error("[weather] cache write failed:", upsertError.message);

  return json(200, {
    configured: true,
    cached: false,
    now,
    air,
    fetchedAt: new Date().toISOString(),
  });
});
