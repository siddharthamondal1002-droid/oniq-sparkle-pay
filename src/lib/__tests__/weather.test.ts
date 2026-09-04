/**
 * GOOGLE WEATHER — the owner's directive, and the four things that keep it
 * from becoming expensive or untrue.
 *
 * OWNER DIRECTIVE 2026-09-04h: "also use Vertex ai through google firebase
 * credentials for google weather". That answered the question the Home note
 * had been holding open — whose bill a weather lookup lands on — and this
 * suite holds the shape of the answer.
 *
 *   1. THE CACHE IS THE COST CONTROL. A metered lookup wanted for a chip on
 *      the most-opened screen in the app is the worst possible shape for a
 *      bill. Snapping to a grid makes it scale with places and time instead of
 *      with users and taps, and the snap has to happen BEFORE the call, not
 *      after.
 *   2. THE EXACT POSITION NEVER LEAVES. The coordinate in the request is the
 *      cache cell's centre, which is both a privacy property and the reason
 *      the cached answer is the right answer for that key.
 *   3. NOTHING IS INVENTED. No temperature, no reading; no reading, no chip.
 *      A temperature is exactly the kind of number that looks harmless
 *      invented and is a lie on somebody's home screen.
 *   4. IT NEVER ASKS AT LAUNCH. playCompliance promises Play that precise
 *      location is "requested at the moment of use, not at launch". A chip on
 *      the front door that prompted on mount would break that promise in the
 *      most visible place in the app.
 *
 * The auth evidence — three probes with a control set, proving the endpoint
 * takes an OAuth 2 token at all — is quoted in weatherCore.ts and asserted
 * below, because that measurement is the whole reason this was buildable.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CACHE_GRID_DEGREES,
  CACHE_TTL_SECONDS,
  cacheKey,
  currentConditionsUrl,
  mapCurrentConditions,
  snapCoord,
  validCoords,
} from "../../../supabase/functions/_shared/weatherCore.ts";
import { isPlace } from "../weatherPlace";
import { degrees, skyLabel, weatherIcon } from "../weather";
import { THIRD_PARTY_REQUESTS } from "../../config/playCompliance";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const CORE = read("supabase/functions/_shared/weatherCore.ts");
const FN = read("supabase/functions/weather/index.ts");
const HOME = read("src/routes/_authenticated/app.index.tsx");
const SCREEN = read("src/routes/_authenticated/app.weather.tsx");
const PLACE = read("src/lib/weatherPlace.ts");
const INVITE = read("src/components/home/WeatherInvite.tsx");

describe("the credential is the owner's, and the endpoint was measured first", () => {
  it("goes through googleAccessToken, which is the Firebase service account", () => {
    // Owner directive 2026-09-04h says Vertex's credentials; 2026-09-04e made
    // that FIREBASE_SERVICE_ACCOUNT. Reusing the same function rather than
    // reading the secret again means one switch turns both off.
    expect(FN).toContain("await googleAccessToken()");
    // It must not read the key itself — the header names the secret, the CODE
    // must never reach for it, or the switch stops being one switch.
    expect(FN).not.toMatch(/Deno\.env\.get\("(FIREBASE_SERVICE_ACCOUNT|GOOGLE_AI_API_KEY)"\)/);
    expect(FN).toContain("GOOGLE_VERTEX_USE_FIREBASE_SA");
  });

  it("keeps the probe that proved OAuth is accepted here at all", () => {
    // The load-bearing measurement. Vertex answered an API key with "API keys
    // are not supported by this API"; this endpoint answered a nonsense Bearer
    // with "Expected OAuth 2 access token", which is the opposite finding and
    // is why the directive was buildable rather than a wish.
    expect(CORE).toContain("EXPECTED OAUTH 2");
    expect(CORE).toContain("ACCESS TOKEN");
  });

  it("keeps the CONTROLS that make that answer mean something", () => {
    // A 401 on its own proves nothing. The no-credential 403 and the
    // API-key-shaped 400 are what show the Authorization header was read and
    // judged rather than ignored.
    expect(CORE).toContain("PERMISSION_DENIED");
    expect(CORE).toContain("API_KEY_INVALID");
  });

  it("says plainly what is still NOT proven", () => {
    // That the Firebase service account in particular may call it needs the
    // real key, which lives only as a Supabase secret.
    expect(CORE).toMatch(/STILL NOT PROVEN/);
  });

  it("sends the project header, which is what names the payer", () => {
    expect(FN).toContain("x-goog-user-project");
  });
});

describe("the cache, which is the cost control", () => {
  it("snaps to a grid of about eleven kilometres", () => {
    expect(CACHE_GRID_DEGREES).toBe(0.1);
    expect(snapCoord(22.5726)).toBeCloseTo(22.6, 6);
    expect(snapCoord(88.3639)).toBeCloseTo(88.4, 6);
    expect(snapCoord(-33.8688)).toBeCloseTo(-33.9, 6);
  });

  it("gives everybody in one cell the same key", () => {
    // Two people 5 km apart in the same city must not be two lookups.
    expect(cacheKey(22.5726, 88.3639)).toBe(cacheKey(22.6104, 88.4001));
    // And two cities must not share one.
    expect(cacheKey(22.5726, 88.3639)).not.toBe(cacheKey(19.076, 72.8777));
  });

  it("produces a stable string, not float noise", () => {
    // 0.1 + 0.2 arithmetic would otherwise make two keys for one cell.
    expect(cacheKey(0.30000000000000004, 0.1)).toBe("0.3,0.1");
    expect(cacheKey(-0.05, -0.05)).toMatch(/^-?0\.[01],-?0\.[01]$/);
  });

  it("holds a reading for fifteen minutes", () => {
    expect(CACHE_TTL_SECONDS).toBe(900);
  });

  it("reads the cache BEFORE minting a token or calling Google", () => {
    // Order is the whole guard: a cache checked after the call saves nothing.
    // Call sites, not the import list at the top of the file.
    const cacheAt = FN.indexOf('.from("weather_cache")');
    const tokenAt = FN.indexOf("await googleAccessToken()");
    const fetchAt = FN.indexOf("currentConditionsUrl(cell.lat");
    expect(cacheAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(cacheAt).toBeLessThan(tokenAt);
    expect(tokenAt).toBeLessThan(fetchAt);
  });

  it("never caches a reading it could not read", () => {
    // A bad shape written to the cache would be served for the next quarter
    // hour, turning one bad response into fifteen minutes of no weather.
    const mapAt = FN.indexOf("mapCurrentConditions(raw)");
    const writeAt = FN.indexOf(".upsert(");
    expect(mapAt).toBeGreaterThan(-1);
    expect(mapAt).toBeLessThan(writeAt);
  });

  it("is a shared table, not a per-isolate Map", () => {
    // Supabase runs many isolates; a Map would let every cold start pay again.
    expect(FN).toContain('.from("weather_cache")');
    expect(FN).not.toMatch(/new Map</);
    expect(read("supabase/migrations/20260904180000_weather_cache.sql")).toContain(
      "create table if not exists public.weather_cache",
    );
  });

  it("keeps the cache table unreadable by any client", () => {
    // A cell is a place, not a person — but a signed-in stranger enumerating
    // which parts of the world ONIQ users ask about is not something to allow.
    const sql = read("supabase/migrations/20260904180000_weather_cache.sql");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toMatch(/create policy/i);
  });
});

describe("the exact position never leaves ONIQ", () => {
  it("sends the CELL CENTRE to Google, not the caller's coordinates", () => {
    expect(FN).toContain("snapCoord(at.lat)");
    expect(FN).toContain("snapCoord(at.lon)");
    expect(FN).toContain("currentConditionsUrl(cell.lat, cell.lon");
    // The raw pair must never be what is handed to the URL builder.
    expect(FN).not.toContain("currentConditionsUrl(at.lat, at.lon");
  });

  it("keeps the place on the device and in no table", () => {
    expect(PLACE).toContain("localStorage");
    expect(PLACE).not.toContain("supabase");
    // Nothing user-keyed is stored server-side either.
    expect(FN).not.toContain("user_id");
  });

  it("is declared in playCompliance, with the grid named", () => {
    const row = THIRD_PARTY_REQUESTS.find((r) => r.host === "weather.googleapis.com");
    expect(row, "weather.googleapis.com is undeclared").toBeTruthy();
    expect(row!.sends).toMatch(/SNAPPED TO A ~11 KM GRID/);
    expect(row!.sends).toMatch(/from the SERVER/);
    // The dead OpenWeather path is gone, not dormant.
    expect(THIRD_PARTY_REQUESTS.map((r) => r.host)).not.toContain("api.openweathermap.org");
  });
});

describe("a metered call is never spent on rubbish", () => {
  it("takes real coordinates", () => {
    expect(validCoords(22.57, 88.36)).toEqual({ lat: 22.57, lon: 88.36 });
    expect(validCoords(-90, 180)).toEqual({ lat: -90, lon: 180 });
  });

  it.each([
    ["a string", "22.57", 88.36],
    ["NaN", Number.NaN, 88.36],
    ["Infinity", Number.POSITIVE_INFINITY, 0.5],
    ["off the planet", 91, 0],
    ["past the date line", 0.5, 181],
    ["undefined", undefined, undefined],
  ])("refuses %s", (_what, lat, lon) => {
    expect(validCoords(lat, lon)).toBeNull();
  });

  it("refuses 0,0, which is an unset variable rather than a place", () => {
    // Null Island. A real reading there would be from a buoy.
    expect(validCoords(0, 0)).toBeNull();
  });

  it("names the units rather than trusting a default", () => {
    // A default that changed on Google's side would turn 28°C into 82°F on a
    // chip that carries no unit.
    const url = currentConditionsUrl(22.6, 88.4);
    expect(url).toContain("unitsSystem=METRIC");
    expect(url).toContain("location.latitude=22.6");
    expect(url).toContain("location.longitude=88.4");
    expect(url).toContain("weather.googleapis.com/v1/currentConditions:lookup");
  });

  it("stops before the call when the switch is off", () => {
    expect(FN).toContain("WEATHER_ENABLED");
    const switchAt = FN.indexOf("if (!enabled())");
    expect(switchAt).toBeGreaterThan(-1);
    expect(switchAt).toBeLessThan(FN.indexOf("await googleAccessToken()"));
  });

  it("treats an unset switch as on, and anything unexpected as off", () => {
    // The same asymmetry googleAuth uses: a mistake in the "on" direction
    // costs a feature, a mistake in the "off" direction costs money.
    expect(FN).toMatch(/raw === "" \|\| raw === "true"/);
  });
});

describe("nothing is invented", () => {
  it("reads a whole reading", () => {
    const now = mapCurrentConditions({
      isDaytime: true,
      weatherCondition: { type: "PARTLY_CLOUDY", description: { text: "Partly cloudy" } },
      temperature: { degrees: 28.4, unit: "CELSIUS" },
      feelsLikeTemperature: { degrees: 31.2 },
      relativeHumidity: 62,
      wind: { speed: { value: 9.4, unit: "KILOMETERS_PER_HOUR" } },
    });
    expect(now).toEqual({
      tempC: 28,
      feelsLikeC: 31,
      condition: "Partly cloudy",
      conditionType: "PARTLY_CLOUDY",
      isDay: true,
      humidity: 62,
      windKmh: 9,
    });
  });

  it("keeps the temperature and drops what is missing, rather than filling it", () => {
    const now = mapCurrentConditions({ temperature: { degrees: 11 } });
    expect(now).toEqual({
      tempC: 11,
      feelsLikeC: null,
      condition: null,
      conditionType: null,
      isDay: true,
      humidity: null,
      windKmh: null,
    });
  });

  it.each([
    ["no temperature", { relativeHumidity: 60 }],
    ["a temperature that is not a number", { temperature: { degrees: "28" } }],
    ["an error body", { error: { code: 403, message: "denied" } }],
    ["null", null],
    ["a string", "28 degrees"],
  ])("returns null for %s", (_what, raw) => {
    expect(mapCurrentConditions(raw)).toBeNull();
  });

  it("only calls it night when Google actually said so", () => {
    // Absent means day: being wrong here swaps a sun for a moon, the cheapest
    // possible mistake, whereas defaulting to night would be wrong all day.
    expect(mapCurrentConditions({ temperature: { degrees: 20 } })!.isDay).toBe(true);
    expect(mapCurrentConditions({ temperature: { degrees: 20 }, isDaytime: false })!.isDay).toBe(
      false,
    );
  });

  it("shows no chip at all unless the reading came back", () => {
    expect(HOME).toContain('weather.data?.state === "ok"');
  });

  it("says so on the screen instead of guessing", () => {
    expect(SCREEN).toContain("No reading right now");
    expect(SCREEN).not.toMatch(/\bunknown °|--°|—°/);
  });
});

describe("the sky is drawn, never described wrongly", () => {
  it.each([
    ["THUNDERSTORM", "CloudLightning"],
    ["RAIN", "CloudRain"],
    ["HEAVY_SNOW", "CloudSnow"],
    ["LIGHT_DRIZZLE", "CloudDrizzle"],
    ["FOG", "CloudFog"],
    ["WINDY", "Wind"],
    ["PARTLY_CLOUDY", "Cloud"],
    ["CLEAR", "Sun"],
  ])("%s draws %s", (type, name) => {
    expect(weatherIcon(type, true).displayName ?? weatherIcon(type, true).name).toBe(name);
  });

  it("tests the compound cases before their parts", () => {
    // RAIN_AND_SNOW contains both RAIN and SNOW; snow has to win, or sleet
    // renders as plain rain.
    const icon = weatherIcon("RAIN_AND_SNOW", true);
    expect(icon.displayName ?? icon.name).toBe("CloudSnow");
  });

  it("gives an unrecognised sky a thermometer rather than nothing", () => {
    // Google adds enum members; a new one must not produce a blank chip.
    const icon = weatherIcon("SOMETHING_GOOGLE_ADDED_LATER", true);
    expect(icon.displayName ?? icon.name).toBe("Thermometer");
    expect(weatherIcon(null).displayName ?? weatherIcon(null).name).toBe("Thermometer");
  });

  it("shows a moon at night and a sun by day", () => {
    expect(weatherIcon("CLEAR", false).displayName ?? weatherIcon("CLEAR", false).name).toBe(
      "Moon",
    );
  });

  it("writes whole degrees with no unit word", () => {
    expect(degrees(28.4)).toBe("28°");
    expect(degrees(-3.6)).toBe("-4°");
  });

  it("uses Google's own words for the sky when there are any", () => {
    const base = {
      tempC: 20,
      feelsLikeC: null,
      conditionType: null,
      humidity: null,
      windKmh: null,
    };
    expect(skyLabel({ ...base, condition: "Light rain", isDay: true })).toBe("Light rain");
    // And says something true, not something invented, when there are none.
    expect(skyLabel({ ...base, condition: null, isDay: true })).toBe("Right now");
    expect(skyLabel({ ...base, condition: null, isDay: false })).toBe("Tonight");
  });
});

describe("it never asks for location at launch", () => {
  it("asks only from a tap", () => {
    // playCompliance promises Play "requested at the moment of use, not at
    // launch". The invite's button IS the moment of use.
    expect(INVITE).toContain("onClick={() => void add()}");
    expect(INVITE).toContain("askForPlace()");
    // No effect anywhere in the chain may call it.
    expect(INVITE).not.toContain("useEffect");
    expect(HOME).not.toContain("askForPlace");
  });

  it("reads a remembered place without prompting", () => {
    // The chip's ordinary path touches no permission at all.
    expect(HOME).toContain("useState(readPlace)");
    expect(PLACE).toContain("getCurrentPosition");
    expect(PLACE).toContain("enableHighAccuracy: false");
  });

  it("takes no for an answer", () => {
    // A refusal that left the button asking again would be the nag the
    // declaration exists to prevent.
    expect(INVITE).toContain("declineWeather()");
    expect(PLACE).toContain("oniq.weather.declined");
  });

  it("offers the invite once and never pads the pulse row with it", () => {
    // The row shows facts; an invitation is not one.
    expect(HOME).toContain("{!place && !declined ? <WeatherInvite");
  });

  it("validates a remembered place before trusting it", () => {
    expect(isPlace({ lat: 22.57, lon: 88.36 })).toBe(true);
    expect(isPlace({ lat: 0, lon: 0 })).toBe(false);
    expect(isPlace({ lat: "22", lon: 88 })).toBe(false);
    expect(isPlace({ lat: 91, lon: 0 })).toBe(false);
    expect(isPlace(null)).toBe(false);
    expect(isPlace("22,88")).toBe(false);
  });
});
