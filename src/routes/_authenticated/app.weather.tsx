import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Droplets, MapPin, Thermometer, Wind } from "lucide-react";
import {
  OniqCanvas,
  OniqCard,
  OniqEmpty,
  OniqHeader,
  OniqIconBadge,
  OniqSkeletonRows,
} from "@/components/oniq";
import { isLive, unavailableMessage } from "@/data/capabilities";
import {
  airLabel,
  airTint,
  aqiValue,
  degrees,
  isRecent,
  skyLabel,
  useWeather,
  weatherIcon,
} from "@/lib/weather";
import {
  askForPlace,
  clearPlace,
  readPlace,
  savePlace,
  type WeatherPlace,
} from "@/lib/weatherPlace";

export const Route = createFileRoute("/_authenticated/app/weather")({
  component: WeatherScreen,
});

/**
 * WEATHER — current conditions, from Google, for a place the person gave us.
 *
 * OWNER DIRECTIVE 2026-09-04h: "also use Vertex ai through google firebase
 * credentials for google weather". This screen and the Home chip are the two
 * places that reading appears.
 *
 * WHAT THIS REPLACED. An OpenWeatherMap screen that had been DEAD since the
 * licence review: OPENWEATHER_API_KEY was never set, so it rendered "Weather
 * isn't configured yet" and made no request, forever. It carried a five-day
 * forecast and a city search that had also never run. Rather than keep that
 * shape and quietly fill a third of it, this ships the part that is real —
 * one live reading — and the server function behind the old screen is deleted
 * so nothing points at a provider ONIQ no longer uses.
 *
 * NO FORECAST YET, and it is absent rather than empty. Google's forecast is a
 * second, separately metered endpoint; adding it is a call about spending that
 * has not been made. An empty "Next 5 days" heading would imply it is coming
 * back in a moment.
 *
 * IT ASKS FOR LOCATION ON A TAP, NEVER ON A MOUNT. playCompliance declares
 * precise location as "Requested at the moment of use, not at launch", and
 * that is a promise to Play rather than a preference. The button below IS the
 * moment of use.
 */
function WeatherScreen() {
  const [place, setPlace] = useState<WeatherPlace | null>(readPlace);
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState(false);
  const weather = useWeather(place);

  const add = async () => {
    setAsking(true);
    setRefused(false);
    const got = await askForPlace();
    setAsking(false);
    if (!got) {
      setRefused(true);
      return;
    }
    savePlace(got);
    setPlace(got);
  };

  const forget = () => {
    clearPlace();
    setPlace(null);
    setRefused(false);
  };

  const reply = weather.data;
  const now = reply?.state === "ok" ? reply.now : null;
  const air = reply?.state === "ok" ? reply.air : null;
  // Shown, but never as "right now" once it stops being that. Same three-hour
  // line the Home chip uses — see READING_MAX_AGE_MS.
  const stale = reply?.state === "ok" && !isRecent(reply.fetchedAt);
  const Icon = now ? weatherIcon(now.conditionType, now.isDay) : Thermometer;

  return (
    <OniqCanvas world="home" className="pb-28">
      <OniqHeader eyebrow="Right now" title="Weather" back="/app" />

      <div className="mt-4 px-5">
        {!isLive("weather.current") && !place ? (
          // NOT YET, AND SAY SO RATHER THAN ASK. The capability is
          // EXPERIMENTAL until one call from the deployed function proves this
          // account may reach Google; until then, asking somebody to hand over
          // their location would be trading a permission for nothing. The
          // sentence is the registry's own, so it cannot drift from the state
          // it describes.
          <OniqEmpty
            emoji="🌥️"
            title={unavailableMessage("weather.current") ?? "Not available yet"}
            body="ONIQ's weather source isn't switched on yet. Nothing to do — it will appear here when it is."
          />
        ) : !place ? (
          <OniqEmpty
            emoji="📍"
            title="Add your location"
            body={
              refused
                ? "Your device didn't share a location. You can allow it in your browser or system settings and try again."
                : "ONIQ knows your country, which isn't somewhere it rains. Share your location once and the weather appears here and on Home."
            }
            action={
              <button
                type="button"
                data-testid="weather-add"
                onClick={() => void add()}
                disabled={asking}
                className="press inline-flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-[13px] font-semibold normal-case tracking-normal text-foreground disabled:opacity-50"
              >
                <MapPin className="h-4 w-4 text-world" aria-hidden="true" />
                {asking ? "Asking…" : "Use my location"}
              </button>
            }
          />
        ) : weather.isPending ? (
          <OniqSkeletonRows rows={2} />
        ) : now ? (
          <>
            <OniqCard variant="surface" className="p-6 text-center" testId="weather-now">
              <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-world-soft">
                <Icon className="h-9 w-9 text-world" aria-hidden="true" />
              </span>
              <p className="mt-4 font-display text-[44px] leading-none normal-case tracking-normal text-foreground">
                {degrees(now.tempC)}
              </p>
              <p className="mt-2 text-[14px] text-foreground">{skyLabel(now)}</p>
              {now.feelsLikeC !== null && now.feelsLikeC !== now.tempC ? (
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Feels like {degrees(now.feelsLikeC)}
                </p>
              ) : null}
            </OniqCard>

            {/* AIR QUALITY — owner directive 2026-09-04i. Its own card because
                it is a different measurement on its own scale, and because it
                may be absent while the temperature is fine: airquality is a
                separate Google API and the function settles it separately.

                THE NUMBER IS GOOGLE'S AND SO IS THE VERDICT. Nothing here
                decides whether an AQI is good — the two index families run in
                opposite directions (Universal AQI 0-100 best-high, CPCB and
                EPA 0-500 worst-high), so the colour comes from Google's own
                category and the index is named underneath rather than implied
                to be the only one. */}
            {air ? (
              <OniqCard variant="surface" className="mt-3 p-4" testId="weather-aqi">
                <div className="flex items-center gap-3">
                  <OniqIconBadge tint={airTint(air.category)} size="sm">
                    <Wind />
                  </OniqIconBadge>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[18px] normal-case tracking-normal text-foreground">
                      {aqiValue(air)}
                    </p>
                    <p className="text-[12px] text-muted-foreground">{airLabel(air)}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  {air.indexName ?? air.code}
                  {air.dominantPollutant ? ` · mostly ${air.dominantPollutant}` : ""}
                </p>
              </OniqCard>
            ) : null}

            {/* Only the readings that came back. A humidity of "—" is a row
                that exists to be empty, which is worse than a shorter list. */}
            {now.humidity !== null || now.windKmh !== null ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {now.humidity !== null ? (
                  <OniqCard variant="surface" className="p-4" testId="weather-humidity">
                    <Droplets className="h-4 w-4 text-world" aria-hidden="true" />
                    <p className="mt-2 font-display text-[20px] normal-case tracking-normal text-foreground">
                      {now.humidity}%
                    </p>
                    <p className="text-[11px] text-muted-foreground">Humidity</p>
                  </OniqCard>
                ) : null}
                {now.windKmh !== null ? (
                  <OniqCard variant="surface" className="p-4" testId="weather-wind">
                    <Wind className="h-4 w-4 text-world" aria-hidden="true" />
                    <p className="mt-2 font-display text-[20px] normal-case tracking-normal text-foreground">
                      {now.windKmh} km/h
                    </p>
                    <p className="text-[11px] text-muted-foreground">Wind</p>
                  </OniqCard>
                ) : null}
              </div>
            ) : null}

            <p className="mt-4 text-center text-[11px] leading-snug text-muted-foreground">
              {stale ? "This reading is a few hours old. " : ""}For the area around you, to about 11
              km. ONIQ never stores where you are — the place is kept on this device only.
            </p>
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                data-testid="weather-forget"
                onClick={forget}
                className="press text-[12px] font-semibold normal-case tracking-normal text-world"
              >
                Forget this location
              </button>
            </div>
          </>
        ) : (
          // Switched off, no credential, or Google could not be read. All three
          // say the same thing to a person and none of them invents a number.
          <OniqEmpty
            emoji="🌥️"
            title="No reading right now"
            body="ONIQ couldn't get the weather for your area. Nothing is wrong with your device — try again in a little while."
            action={
              <button
                type="button"
                data-testid="weather-retry"
                onClick={() => void weather.refetch()}
                className="press inline-flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-[13px] font-semibold normal-case tracking-normal text-foreground"
              >
                Try again
              </button>
            }
          />
        )}
      </div>
    </OniqCanvas>
  );
}
