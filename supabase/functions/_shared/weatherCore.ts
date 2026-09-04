/**
 * GOOGLE WEATHER — the pure half.
 *
 * OWNER DIRECTIVE, 2026-09-04h: "also use Vertex ai through google firebase
 * credentials for google weather". The Home reference draws a weather chip
 * ("28° Kolkata") and ONIQ has never had one, because the note on
 * app.index.tsx said plainly what was missing: the Google weather source
 * needs service-account OAuth2, and choosing which credential pays for it is
 * the owner's call. This is that call, and it is the SAME credential
 * `googleAuth.ts` already mints Vertex tokens with — `FIREBASE_SERVICE_ACCOUNT`
 * under owner directive 2026-09-04e — so weather lands on the Firebase
 * project's billing account alongside Vertex, and the same
 * `GOOGLE_VERTEX_USE_FIREBASE_SA=false` switch turns both off without a deploy.
 *
 * MEASURED BEFORE ANY OF THIS WAS WRITTEN, against the live endpoint from this
 * container, 2026-09-04. Three requests to
 * `weather.googleapis.com/v1/currentConditions:lookup`, which is the control
 * set that makes the middle one mean something:
 *
 *   no credential at all   -> 403 PERMISSION_DENIED, "Method doesn't allow
 *                             unregistered callers (callers without
 *                             established identity). Please use API Key OR
 *                             OTHER FORM OF API CONSUMER IDENTITY."
 *   a nonsense Bearer      -> 401 UNAUTHENTICATED, "Request had invalid
 *                             authentication credentials. EXPECTED OAUTH 2
 *                             ACCESS TOKEN, login cookie or other valid
 *                             authentication credential."
 *   a nonsense API key     -> 400 INVALID_ARGUMENT, API_KEY_INVALID, with
 *                             `"service": "weather.googleapis.com"`.
 *
 * The middle answer is the one that matters and the outer two are what let it
 * be read. The Authorization header was PARSED and judged as an OAuth
 * credential — "expected OAuth 2 access token" — rather than waved away, and
 * the API-key path is a visibly DIFFERENT error route. So OAuth 2 is a
 * supported credential type on this API, which is the exact opposite of what
 * Vertex said to an API key ("API keys are not supported by this API") and is
 * what makes the owner's directive buildable rather than a wish.
 *
 * WHAT IS STILL NOT PROVEN, and is therefore not claimed anywhere: that the
 * Firebase service account in particular may call it. That needs the real key,
 * which lives only as a Supabase secret, so it is proven by the deployed
 * function and nowhere else. Until that run happens this path is EXPERIMENTAL
 * in capabilityRegistry.ts and the screen says nothing rather than guessing.
 *
 * GET, not POST — also measured. The probes above were GETs carrying the
 * coordinates as query parameters and were answered on the credential rather
 * than refused as the wrong method.
 */

/** Google's weather host. One place, so a typo cannot hide in a template. */
export const WEATHER_HOST = "https://weather.googleapis.com";

/**
 * The OAuth scope. The broad Cloud one, the same `googleAuth.ts` already asks
 * for — weather.googleapis.com is an ordinary Google Cloud service, so no
 * second scope and no second token are needed.
 */
export const WEATHER_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * HOW COARSE THE CACHE KEY IS, in degrees. 0.1° is about 11 km — one weather
 * cell, and small enough that nobody is shown another city's sky.
 *
 * THIS IS THE COST CONTROL, and it is worth being explicit about why. Every
 * lookup is metered on the owner's Firebase bill, and a chip on the HOME
 * screen is the most-opened surface in the app: one call per app open per user
 * is the shape that turns a small per-call price into a real monthly number.
 * Rounding to a grid collapses everyone in a city into one row, so the bill
 * scales with PLACES and TIME rather than with users and taps.
 */
export const CACHE_GRID_DEGREES = 0.1;

/** How long a cached reading stands. Weather does not change in a minute. */
export const CACHE_TTL_SECONDS = 15 * 60;

/** Snap a coordinate to the cache grid. */
export function snapCoord(n: number): number {
  // Rounded through an integer count of cells so 0.1 + 0.2 style float error
  // cannot produce two keys for one cell.
  return Math.round(n / CACHE_GRID_DEGREES) * CACHE_GRID_DEGREES;
}

/** The shared cache key for a place: one row per cell, not per user. */
export function cacheKey(lat: number, lon: number): string {
  return `${snapCoord(lat).toFixed(1)},${snapCoord(lon).toFixed(1)}`;
}

/**
 * Coordinates worth spending a call on.
 *
 * A metered API must never be handed rubbish: NaN, a string that parsed to
 * nothing, or 0,0 — which is in the Atlantic and is what an uninitialised
 * pair of variables looks like. Rejecting here costs nothing; discovering it
 * from a bill costs money.
 */
export function validCoords(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  // Null Island. A real reading there would be from a buoy, and no ONIQ user
  // is on one; a 0,0 is an unset variable every time.
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/** The current-conditions URL, units named rather than assumed. */
export function currentConditionsUrl(lat: number, lon: number, languageCode = "en"): string {
  const q = new URLSearchParams({
    "location.latitude": String(lat),
    "location.longitude": String(lon),
    // ASKED FOR EXPLICITLY. A default that changes on Google's side would
    // silently turn 28°C into 82°F on somebody's home screen, and the number
    // carries no unit on the chip.
    unitsSystem: "METRIC",
    languageCode,
  });
  return `${WEATHER_HOST}/v1/currentConditions:lookup?${q}`;
}

/** What ONIQ keeps from a reading. Everything is optional but the temperature. */
export type WeatherNow = {
  /** Whole degrees Celsius. The chip has no room for a decimal. */
  tempC: number;
  feelsLikeC: number | null;
  /** Google's own words for the sky, e.g. "Partly cloudy". */
  condition: string | null;
  /** Google's enum, e.g. "CLEAR" — what the emoji is chosen from. */
  conditionType: string | null;
  isDay: boolean;
  humidity: number | null;
  windKmh: number | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A reading out of Google's JSON, or null.
 *
 * NULL RATHER THAN A GUESS, and the whole screen is built around that: the
 * chip renders nothing when this returns null. A temperature is exactly the
 * kind of number that looks harmless invented and is a lie on somebody's home
 * screen — the note this replaces on app.index.tsx said so before there was
 * any weather at all, and it still governs.
 *
 * Every field is read defensively because the response shape here is the ONE
 * part of this file that has not been seen from the live endpoint — the probes
 * that proved the auth never got far enough to return a body. Reading it
 * loosely means an unexpected shape costs a missing chip, not an exception on
 * the busiest screen in the app.
 */
export function mapCurrentConditions(raw: unknown): WeatherNow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const temp = r.temperature as Record<string, unknown> | undefined;
  const degrees = num(temp?.degrees);
  // No temperature, no reading. Everything else is decoration.
  if (degrees === null) return null;

  const feels = r.feelsLikeTemperature as Record<string, unknown> | undefined;
  const cond = r.weatherCondition as Record<string, unknown> | undefined;
  const desc = cond?.description as Record<string, unknown> | undefined;
  const wind = r.wind as Record<string, unknown> | undefined;
  const windSpeed = wind?.speed as Record<string, unknown> | undefined;

  return {
    tempC: Math.round(degrees),
    feelsLikeC: feels
      ? num(feels.degrees) === null
        ? null
        : Math.round(num(feels.degrees)!)
      : null,
    condition: typeof desc?.text === "string" && desc.text ? desc.text : null,
    conditionType: typeof cond?.type === "string" && cond.type ? cond.type : null,
    // Absent means day. Being wrong about this swaps a sun for a moon, which
    // is the cheapest possible mistake here.
    isDay: r.isDaytime !== false,
    humidity: num(r.relativeHumidity),
    windKmh: windSpeed
      ? num(windSpeed.value) === null
        ? null
        : Math.round(num(windSpeed.value)!)
      : null,
  };
}
