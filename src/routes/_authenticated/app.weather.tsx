import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Sun, Cloud, CloudRain, CloudSnow, CloudLightning, Wind, Droplets, MapPin, Search } from "lucide-react";
import { getWeather, type WeatherNow, type WeatherDay } from "@/lib/weather.functions";

export const Route = createFileRoute("/_authenticated/app/weather")({
  component: WeatherScreen,
});

function iconFor(condition: string) {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("drizzle")) return CloudRain;
  if (c.includes("snow")) return CloudSnow;
  if (c.includes("thunder")) return CloudLightning;
  if (c.includes("cloud")) return Cloud;
  return Sun;
}

function WeatherScreen() {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [city, setCity] = useState("");
  const [searchedCity, setSearchedCity] = useState("");
  const [geoDenied, setGeoDenied] = useState(false);

  // Ask for location once (effect, never during render/SSR)
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => setGeoDenied(true),
        { timeout: 8000 },
      );
    } else {
      setGeoDenied(true);
    }
  }, []);

  const enabled = !!coords || !!searchedCity;
  const { data, isLoading, error } = useQuery({
    queryKey: ["weather", coords?.lat, coords?.lon, searchedCity],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: () =>
      getWeather({
        data: searchedCity ? { city: searchedCity } : { lat: coords!.lat, lon: coords!.lon },
      }),
  });

  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Weather</h1>
      </div>

      {/* City search — shown if geolocation denied or user wants another city */}
      {(geoDenied || searchedCity) && (
        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && city.trim() && setSearchedCity(city.trim())}
              placeholder="Enter your city"
              className="w-full rounded-2xl border border-border bg-card py-3 pl-10 pr-3 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <button
            onClick={() => city.trim() && setSearchedCity(city.trim())}
            className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      )}

      {!enabled && !geoDenied && (
        <div className="mt-8 rounded-3xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Waiting for your location…
        </div>
      )}

      {isLoading && enabled && (
        <div className="mt-5 h-56 animate-pulse rounded-3xl border border-border bg-card" />
      )}

      {error && (
        <div className="mt-5 rounded-3xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Couldn't load weather. {String((error as Error).message)}
        </div>
      )}

      {data && !data.configured && (
        <div className="mt-5 rounded-3xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Weather isn't configured yet. Add an <span className="font-mono text-foreground">OPENWEATHER_API_KEY</span> secret to enable live forecasts.
        </div>
      )}

      {data?.configured && <LiveWeather now={data.now} forecast={data.forecast} />}
    </div>
  );
}

function LiveWeather({ now, forecast }: { now: WeatherNow; forecast: WeatherDay[] }) {
  const NowIcon = iconFor(now.condition);
  return (
    <>
      <div className="mt-5 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary to-blue-500 p-6 text-primary-foreground shadow-card">
        <div className="text-sm opacity-90">Your location</div>
        <div className="font-display text-xl font-semibold">{now.city}</div>
        <div className="mt-4 flex items-end gap-4">
          <NowIcon className="h-16 w-16" />
          <div>
            <div className="font-display text-6xl font-bold">{now.temp}°</div>
            <div className="text-sm opacity-90">
              {now.condition} · Feels like {now.feelsLike}°
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
          <Stat icon={Wind} label="Wind" value={`${now.windKmh} km/h`} />
          <Stat icon={Droplets} label="Humidity" value={`${now.humidity}%`} />
          <Stat icon={CloudRain} label="Condition" value={now.condition} />
        </div>
      </div>

      <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
        Next days
      </h2>
      <div className="mt-3 space-y-2">
        {forecast.map((d) => {
          const DayIcon = iconFor(d.condition);
          return (
            <div key={d.day} className="flex items-center justify-between rounded-2xl border border-border bg-card p-3">
              <div className="w-12 text-sm font-medium">{d.day}</div>
              <DayIcon className="h-5 w-5 text-amber" />
              <div className="text-sm text-muted-foreground">
                {d.max}° / {d.min}°
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Sun; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-background/15 py-2.5 backdrop-blur">
      <Icon className="mx-auto h-4 w-4" />
      <div className="mt-1 truncate font-semibold">{value}</div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}
