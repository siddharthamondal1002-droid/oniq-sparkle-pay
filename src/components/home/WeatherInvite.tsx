/**
 * "ADD YOUR WEATHER" — the one-tap way the Home chip comes to exist.
 *
 * OWNER DIRECTIVE 2026-09-04h put Google Weather on the Firebase service
 * account, which answered the question that had kept the reference's weather
 * chip off Home. It did not answer a second one: ONIQ holds a home country and
 * a current region, and neither is somewhere it rains. The reading needs
 * coordinates, and only the person can give those.
 *
 * THE TAP IS THE PERMISSION PROMPT. playCompliance declares precise location
 * as "Requested at the moment of use, not at launch" — a promise to Play, not
 * a preference — so nothing here runs on mount. Pressing the button is the
 * moment of use, and the answer is kept on the device (weatherPlace.ts), never
 * in a row.
 *
 * IT IS DISMISSIBLE, AND THE DISMISSAL IS FINAL. The pulse row beside it shows
 * facts and is deliberately shorter when there are fewer of them rather than
 * padded out. An invitation is not a fact, so it earns one showing: the ✕
 * removes it for good on this device, and adding a place removes it too.
 */
import { useState } from "react";
import { MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { askForPlace, declineWeather, savePlace, type WeatherPlace } from "@/lib/weatherPlace";

export function WeatherInvite({ onAdded }: { onAdded: (place: WeatherPlace) => void }) {
  const [gone, setGone] = useState(false);
  const [asking, setAsking] = useState(false);

  if (gone) return null;

  const add = async () => {
    setAsking(true);
    const got = await askForPlace();
    setAsking(false);
    if (!got) {
      // A refusal is an answer, not a failure, and it must not turn into a
      // button that keeps asking. It goes away exactly as if dismissed.
      toast("No location shared — you can add it later from Weather.");
      declineWeather();
      setGone(true);
      return;
    }
    savePlace(got);
    setGone(true);
    onAdded(got);
  };

  const dismiss = () => {
    declineWeather();
    setGone(true);
  };

  return (
    <div
      data-testid="home-weather-invite"
      className="mt-4 flex items-center gap-2 rounded-full oniq-surface py-1.5 pe-1.5 ps-3.5"
    >
      <MapPin className="h-4 w-4 shrink-0 text-world" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
        Add your location for the weather
      </span>
      <button
        type="button"
        data-testid="home-weather-add"
        onClick={() => void add()}
        disabled={asking}
        className="press shrink-0 rounded-full bg-world-soft px-3 py-1.5 text-[12px] font-semibold normal-case tracking-normal text-world disabled:opacity-50"
      >
        {asking ? "Asking…" : "Add"}
      </button>
      <button
        type="button"
        data-testid="home-weather-dismiss"
        onClick={dismiss}
        aria-label="Don't show this again"
        className="press grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
