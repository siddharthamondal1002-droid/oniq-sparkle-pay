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
import { supabase } from "@/integrations/supabase/client";
import type { WeatherPlace } from "@/lib/weatherPlace";

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
  /** A real reading. */
  | { state: "ok"; now: WeatherNow; cached: boolean; fetchedAt: string }
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

function normalise(data: unknown): WeatherReply {
  const d = (data ?? {}) as Record<string, unknown>;
  const reason = typeof d.reason === "string" ? d.reason : null;
  if (d.configured === false) return { state: "off", reason };
  if (d.unavailable === true) return { state: "unavailable", reason };
  const now = d.now as WeatherNow | undefined;
  if (!now || typeof now.tempC !== "number") return { state: "unavailable", reason };
  return {
    state: "ok",
    now,
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
    queryFn: async (): Promise<WeatherReply> => {
      const { data, error } = await supabase.functions.invoke("weather", {
        body: { lat: place!.lat, lon: place!.lon },
      });
      if (error) return { state: "unavailable", reason: null };
      return normalise(data);
    },
  });
}
