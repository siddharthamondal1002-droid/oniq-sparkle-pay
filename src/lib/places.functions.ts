import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Google Places API (New) — autocomplete + details.
// Uses GOOGLE_MAPS_API_KEY. Callers must treat any thrown error as a
// signal to fall back to their existing search flow.

export type PlaceSuggestion = { placeId: string; label: string; secondary?: string };

export const placesAutocomplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { input: string; near?: { lat: number; lon: number } | null }) => d)
  .handler(async ({ data }): Promise<{ suggestions: PlaceSuggestion[] }> => {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY not configured");
    const input = (data.input ?? "").trim();
    if (input.length < 2) return { suggestions: [] };

    const body: Record<string, unknown> = {
      input,
      includedRegionCodes: ["in"],
      languageCode: "en",
    };
    if (data.near && Number.isFinite(data.near.lat) && Number.isFinite(data.near.lon)) {
      body.locationBias = {
        circle: {
          center: { latitude: data.near.lat, longitude: data.near.lon },
          radius: 50000,
        },
      };
    }

    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Places autocomplete ${res.status}: ${text.slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
          text?: { text?: string };
        };
      }>;
    };
    const suggestions: PlaceSuggestion[] = (j.suggestions ?? [])
      .map((s): PlaceSuggestion | null => {
        const p = s.placePrediction;
        if (!p?.placeId) return null;
        const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
        const secondary = p.structuredFormat?.secondaryText?.text ?? undefined;
        if (!main) return null;
        return { placeId: p.placeId, label: main, secondary };
      })
      .filter((x): x is PlaceSuggestion => x !== null)
      .slice(0, 6);
    return { suggestions };
  });

export const placeDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { placeId: string }) => d)
  .handler(async ({ data }): Promise<{ lat: number; lon: number; label: string }> => {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY not configured");
    const pid = (data.placeId ?? "").trim();
    if (!pid) throw new Error("placeId required");

    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(pid)}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Place details ${res.status}: ${text.slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    };
    const lat = j.location?.latitude;
    const lon = j.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Place details missing coordinates");
    }
    const name = j.displayName?.text ?? "";
    const addr = j.formattedAddress ?? "";
    const label = [name, addr].filter(Boolean).join(", ") || name || addr || "Selected place";
    return { lat: lat as number, lon: lon as number, label };
  });
