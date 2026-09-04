/**
 * WHERE ONIQ THINKS YOU ARE, for the weather chip — and why it is a device
 * value rather than a row.
 *
 * ONIQ knows a person's HOME COUNTRY and their current REGION, and neither is
 * a place you can have weather at. A country is not somewhere it rains. So the
 * chip needs coordinates, and coordinates have to come from the person.
 *
 * IT NEVER ASKS AT LAUNCH. src/config/playCompliance.ts declares precise
 * location as "Requested at the moment of use, not at launch... not persisted
 * by ONIQ", and that declaration is a promise to Google Play, not a comment. A
 * weather chip that prompted for location on the Home screen would break it on
 * the app's front door. So the chip is OPT-IN: nothing until the person taps
 * "Add weather", the prompt is that tap, and the answer is remembered HERE —
 * in localStorage on their own device — so it is asked once and never again.
 *
 * NOTHING GOES TO A TABLE. The coordinates reach the server only as the
 * argument to a lookup, are snapped to a ~11 km grid before they leave ONIQ,
 * and are not stored against the person anywhere. That keeps the Data safety
 * declaration true, and it means clearing the place is genuinely deleting it.
 */

const KEY = "oniq.weather.place";
/** Set when the person has said no to the invite. Its own key, so forgetting
 *  a place does not silently re-open an invitation they already declined. */
const DECLINED_KEY = "oniq.weather.declined";

export type WeatherPlace = {
  lat: number;
  lon: number;
  /** What the person called it, when they chose it. Blank is fine. */
  label?: string;
};

/** True for something that could actually be a place on Earth. */
export function isPlace(v: unknown): v is WeatherPlace {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.lat === "number" &&
    typeof p.lon === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180 &&
    // 0,0 is the Atlantic and is what an unset pair of variables looks like.
    !(p.lat === 0 && p.lon === 0)
  );
}

/** The remembered place, or null. Never throws — storage can be unavailable. */
export function readPlace(): WeatherPlace | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPlace(parsed) ? parsed : null;
  } catch {
    // A private window, blocked site data, or somebody's hand-edited value.
    // None of those is worth an exception on the Home screen.
    return null;
  }
}

export function savePlace(place: WeatherPlace): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(place));
  } catch {
    // Nothing to do and nothing to say: the chip simply will not persist.
  }
}

export function clearPlace(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* see savePlace */
  }
}

/**
 * Ask the device where it is. THE CALL IS THE MOMENT OF USE — only ever from a
 * tap, never from a mount.
 *
 * Resolves to null rather than rejecting when permission is refused or the
 * device cannot say, because "no" is an ordinary answer here and the caller's
 * job is the same either way: show no chip.
 */
export async function askForPlace(): Promise<WeatherPlace | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const place = { lat: p.coords.latitude, lon: p.coords.longitude };
        resolve(isPlace(place) ? place : null);
      },
      () => resolve(null),
      // No high accuracy: the reading is snapped to an 11 km grid server-side
      // anyway, so asking the device to wake the GPS would spend battery to
      // produce digits that are thrown away. A cached fix up to ten minutes
      // old is more than good enough for the sky.
      { timeout: 10_000, maximumAge: 10 * 60_000, enableHighAccuracy: false },
    );
  });
}

/**
 * Whether the Home invite has been waved away.
 *
 * THE INVITE IS NOT A FACT, and the Home pulse row is a row of facts — the
 * note above useHomePulse is explicit that it shows what is true and is simply
 * shorter when less is, rather than being padded. "You have not set up
 * weather" is not true of the world, so it gets exactly one showing and one
 * dismissal, and then it is gone for good on this device.
 */
export function weatherDeclined(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) === "1";
  } catch {
    // Storage unavailable: treat it as declined rather than as an invitation
    // that can never be dismissed.
    return true;
  }
}

export function declineWeather(): void {
  try {
    localStorage.setItem(DECLINED_KEY, "1");
  } catch {
    /* see savePlace */
  }
}
