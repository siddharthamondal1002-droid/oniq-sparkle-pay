/**
 * THE WEATHER, on the client side.
 *
 * OWNER DIRECTIVE 2026-09-04h routed this at Google Weather on the Firebase
 * service account. The evidence that the endpoint takes an OAuth token at all,
 * and the guards around the metered call, live in
 * supabase/functions/_shared/weatherCore.ts and the `weather` function; this
 * file is only the read.
 *
 * IT ASKS FOR NOTHING BY ITSELF. The query runs only when a place is already
 * remembered on this device — see weatherPlace.ts for why the prompt has to be
 * a tap and not a mount.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Moon,
  Sun,
  Thermometer,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { Tint } from "@/design/tints";
import { supabase } from "@/integrations/supabase/client";
import type { WeatherPlace } from "@/lib/weatherPlace";

/** Mirrors AirNow in supabase/functions/_shared/weatherCore.ts. */
export type AirNow = {
  aqi: number;
  code: string;
  indexName: string | null;
  category: string | null;
  dominantPollutant: string | null;
};

/** Mirrors WeatherNow in supabase/functions/_shared/weatherCore.ts. */
export type WeatherNow = {
  tempC: number;
  feelsLikeC: number | null;
  condition: string | null;
  conditionType: string | null;
  isDay: boolean;
  humidity: number | null;
  windKmh: number | null;
};

export type WeatherReply =
  /** A real reading. `air` is independently optional — see the function. */
  | { state: "ok"; now: WeatherNow; air: AirNow | null; cached: boolean; fetchedAt: string }
  /** Switched off, or no credential. Not an error, and not the user's problem. */
  | { state: "off"; reason: string | null }
  /** Configured, but Google could not be read this time. */
  | { state: "unavailable"; reason: string | null };

/**
 * The sky, as one of the icons this app already draws with.
 *
 * SUBSTRING MATCHING, in a deliberate order, because Google adds enum members
 * and an unrecognised one must land on a plausible sky rather than on nothing.
 * The compound cases go first: RAIN_AND_SNOW contains both RAIN and SNOW.
 */
export function weatherIcon(type: string | null | undefined, isDay = true): LucideIcon {
  const t = (type ?? "").toUpperCase();
  if (t.includes("THUNDER")) return CloudLightning;
  if (t.includes("SNOW") || t.includes("SLEET") || t.includes("HAIL") || t.includes("ICE")) {
    return CloudSnow;
  }
  if (t.includes("DRIZZLE")) return CloudDrizzle;
  if (t.includes("RAIN") || t.includes("SHOWER")) return CloudRain;
  if (t.includes("FOG") || t.includes("HAZE") || t.includes("MIST") || t.includes("SMOKE")) {
    return CloudFog;
  }
  if (t.includes("WIND")) return Wind;
  if (t.includes("CLOUD") || t.includes("OVERCAST") || t.includes("PARTLY")) return Cloud;
  if (t.includes("CLEAR") || t.includes("SUNNY")) return isDay ? Sun : Moon;
  // Unknown sky. A thermometer says "this is weather" and claims nothing about
  // what it looks like outside — the same rule the mapper follows.
  return Thermometer;
}

/** "28°" — whole degrees, no unit word. The chip has no room for one. */
export function degrees(tempC: number): string {
  return `${Math.round(tempC)}°`;
}

/** Google's own words for the sky, or a plain fallback. Never invented. */
export function skyLabel(now: WeatherNow): string {
  if (now.condition) return now.condition;
  return now.isDay ? "Right now" : "Tonight";
}

/**
 * THE TINT FOR AN AIR READING, from Google's WORDS and never from its number.
 *
 * The number cannot be judged without knowing which index produced it, and the
 * two kinds run in opposite directions: Google's Universal AQI is 0-100 with
 * 100 the BEST air, while CPCB, EPA and the rest are roughly 0-500 with the
 * high end the worst. One "green under 50" rule would colour clean air as
 * hazardous for half the world.
 *
 * Google's `category` is correct for whichever index it came from, so that is
 * what is read. Matched worst-first, because the bad categories contain the
 * better ones as substrings — "Very poor" contains "poor", and the US EPA's
 * "Unhealthy for sensitive groups" contains "unhealthy".
 */
export function airTint(category: string | null | undefined): Tint {
  const c = (category ?? "").toLowerCase();
  if (!c) return "slate";
  if (c.includes("hazardous") || c.includes("severe")) return "rose";
  if (c.includes("very poor") || c.includes("very unhealthy")) return "red";
  if (c.includes("sensitive")) return "orange";
  if (c.includes("poor") || c.includes("unhealthy") || c.includes("bad")) return "red";
  if (c.includes("moderate") || c.includes("satisfactory") || c.includes("fair")) return "amber";
  if (c.includes("excellent") || c.includes("good")) return "green";
  // A category Google added that is not in this list. Grey says "this is a
  // reading" and claims nothing about whether it is good.
  return "slate";
}

/**
 * The short label under the number. Google's own category, trimmed of the
 * words that only repeat the heading — "Good air quality" reads better as
 * "Good" beside a chip already labelled AQI.
 */
export function airLabel(air: AirNow): string {
  const c = (air.category ?? "").replace(/\s*air quality\s*/i, "").trim();
  if (c) return c[0].toUpperCase() + c.slice(1);
  return air.indexName ?? "Air quality";
}

/** "AQI 62". The index code travels separately, for the screen's small print. */
export function aqiValue(air: AirNow): string {
  return `AQI ${air.aqi}`;
}

/**
 * HOW OLD A READING MAY BE and still be shown as "right now".
 *
 * OWNER DIRECTIVE 2026-09-04i: once weather is selected, keep the chip always
 * on. A chip that vanished whenever a lookup failed would be the opposite —
 * it would blink out on a train, in a tunnel, or any time Google was slow,
 * which is exactly when a person is most likely to be looking at it.
 *
 * So the last good reading is kept on the device and shown while a new one is
 * fetched or fails. THREE HOURS is where that stops: a temperature from this
 * morning presented as now is the same lie as an invented one, just better
 * disguised. Past it the chip is still there — always on, as directed — but it
 * offers a refresh instead of a number.
 */
export const READING_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** True while a reading may still be described as the weather right now. */
export function isRecent(fetchedAt: string | null | undefined, now = Date.now()): boolean {
  if (!fetchedAt) return false;
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return false;
  // A clock skewed into the future would otherwise make a reading immortal.
  return at <= now + 60_000 && now - at <= READING_MAX_AGE_MS;
}

const lastKey = (place: WeatherPlace) =>
  `oniq.weather.last.${place.lat.toFixed(1)},${place.lon.toFixed(1)}`;

/** The last good reading for this place, kept on the device and nowhere else. */
function readLast(place: WeatherPlace | null): WeatherReply | null {
  if (!place) return null;
  try {
    const raw = localStorage.getItem(lastKey(place));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WeatherReply;
    // Only a real reading is worth keeping; an "off" or "unavailable" is not
    // something to show later.
    return parsed?.state === "ok" && typeof parsed.now?.tempC === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function writeLast(place: WeatherPlace, reply: WeatherReply): void {
  if (reply.state !== "ok") return;
  try {
    localStorage.setItem(lastKey(place), JSON.stringify(reply));
  } catch {
    /* private window, blocked storage: the chip simply will not persist */
  }
}

function normalise(data: unknown): WeatherReply {
  const d = (data ?? {}) as Record<string, unknown>;
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (d.configured === false) return { state: "off", reason };
  if (d.unavailable === true) return { state: "unavailable", reason };
  const now = d.now as WeatherNow | undefined;
  if (!now || typeof now.tempC !== "number") return { state: "unavailable", reason };
  const rawAir = d.air as AirNow | undefined | null;
  return {
    state: "ok",
    now,
    air: rawAir && typeof rawAir.aqi === "number" ? rawAir : null,
    cached: d.cached === true,
    fetchedAt: typeof d.fetchedAt === "string" ? d.fetchedAt : new Date().toISOString(),
  };
}

/**
 * The reading for a remembered place.
 *
 * `staleTime` matches the server's cache window, so the app does not send a
 * request it already knows the answer to. Passing null asks nothing at all —
 * which is the state every person is in until they opt in.
 */
export function useWeather(place: WeatherPlace | null) {
  return useQuery({
    queryKey: ["weather", place?.lat?.toFixed(1), place?.lon?.toFixed(1)],
    enabled: Boolean(place),
    // The server holds a reading for fifteen minutes; asking sooner can only
    // return the same row.
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    // A failed lookup is not worth three of them. The chip is decoration on
    // the Home screen, and a retry storm against a metered API is not.
    retry: false,
    refetchOnWindowFocus: false,
    // THE LAST GOOD READING, so the chip is there on the first paint after a
    // reload rather than appearing a second later — and so a failed lookup
    // leaves the previous answer standing instead of a hole. `updatedAt` is
    // the reading's own timestamp, so react-query treats an old one as stale
    // and refetches rather than trusting it for another fifteen minutes.
    initialData: () => readLast(place) ?? undefined,
    initialDataUpdatedAt: () => {
      const last = readLast(place);
      return last?.state === "ok" ? Date.parse(last.fetchedAt) : 0;
    },
    queryFn: async (): Promise<WeatherReply> => {
      const { data, error } = await supabase.functions.invoke("weather", {
        body: { lat: place!.lat, lon: place!.lon },
      });
      const reply: WeatherReply = error ? { state: "unavailable", reason: null } : normalise(data);
      if (place) writeLast(place, reply);
      // A failure must not erase what we already had. Throwing hands
      // react-query the error and it keeps serving the previous data, which is
      // exactly the "always on" the owner asked for.
      if (reply.state !== "ok") throw new Error(reply.reason ?? reply.state);
      return reply;
    },
  });
}
