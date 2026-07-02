import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Live weather via OpenWeatherMap. Key stays on the server.
// Set OPENWEATHER_API_KEY in your project's environment/secrets.

export type WeatherNow = {
  city: string;
  temp: number;
  feelsLike: number;
  condition: string;
  icon: string;
  windKmh: number;
  humidity: number;
};

export type WeatherDay = {
  day: string;
  min: number;
  max: number;
  condition: string;
  icon: string;
};

export const getWeather = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lat?: number; lon?: number; city?: string }) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      return { configured: false as const };
    }

    let lat = data.lat;
    let lon = data.lon;
    let cityName = data.city ?? "";

    // Resolve a typed city name to coordinates
    if ((lat == null || lon == null) && data.city) {
      const geo = await fetch(
        `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(data.city)}&limit=1&appid=${apiKey}`,
      );
      const places = (await geo.json()) as Array<{ lat: number; lon: number; name: string }>;
      if (!places[0]) throw new Error("City not found");
      lat = places[0].lat;
      lon = places[0].lon;
      cityName = places[0].name;
    }
    if (lat == null || lon == null) throw new Error("Location required");

    const [nowRes, fcRes] = await Promise.all([
      fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`,
      ),
      fetch(
        `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`,
      ),
    ]);
    if (!nowRes.ok || !fcRes.ok) throw new Error("Weather service unavailable");

    const nowJson = (await nowRes.json()) as {
      name: string;
      main: { temp: number; feels_like: number; humidity: number };
      weather: Array<{ main: string; icon: string }>;
      wind: { speed: number };
    };
    const fcJson = (await fcRes.json()) as {
      list: Array<{
        dt: number;
        main: { temp_min: number; temp_max: number };
        weather: Array<{ main: string; icon: string }>;
      }>;
    };

    const now: WeatherNow = {
      city: cityName || nowJson.name,
      temp: Math.round(nowJson.main.temp),
      feelsLike: Math.round(nowJson.main.feels_like),
      condition: nowJson.weather[0]?.main ?? "",
      icon: nowJson.weather[0]?.icon ?? "01d",
      windKmh: Math.round(nowJson.wind.speed * 3.6),
      humidity: nowJson.main.humidity,
    };

    // Collapse 3-hourly forecast into daily min/max
    const byDay = new Map<string, WeatherDay>();
    for (const slot of fcJson.list) {
      const d = new Date(slot.dt * 1000);
      const key = d.toLocaleDateString("en-US", { weekday: "short" });
      const existing = byDay.get(key);
      if (!existing) {
        byDay.set(key, {
          day: key,
          min: Math.round(slot.main.temp_min),
          max: Math.round(slot.main.temp_max),
          condition: slot.weather[0]?.main ?? "",
          icon: slot.weather[0]?.icon ?? "01d",
        });
      } else {
        existing.min = Math.min(existing.min, Math.round(slot.main.temp_min));
        existing.max = Math.max(existing.max, Math.round(slot.main.temp_max));
      }
    }

    return { configured: true as const, now, forecast: [...byDay.values()].slice(0, 6) };
  });
