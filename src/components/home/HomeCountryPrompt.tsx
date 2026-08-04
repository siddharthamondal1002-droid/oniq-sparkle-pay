// One-time, dismissible prompt asking the user to CONFIRM their home country
// when `profiles.country_code` is null. Null is the honest "not yet confirmed"
// state — the database treats it with the strictest age threshold (18), and
// dismissing this prompt must never write a value.
//
// Reuses the single country list from src/lib/country.ts. There is deliberately
// no pre-selected option: this is a genuine choice, not a confirm-the-guess.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { COUNTRIES, setCountry } from "@/lib/country";
import type { CountryCode } from "@/lib/miniapps";

const DISMISS_KEY = "oniq.country.confirm.dismissed";

export function HomeCountryPrompt() {
  const [show, setShow] = useState(false);
  const [choice, setChoice] = useState<"" | CountryCode>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (localStorage.getItem(DISMISS_KEY) === "1") return;
      } catch {
        /* noop */
      }
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user) return;
        const { data: row } = await supabase.rpc("get_my_profile_meta").maybeSingle();
        if (!cancelled && !row?.country_code) setShow(true);
      } catch {
        /* offline — ask again next time */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    // Dismissal writes NOTHING to the profile — the value stays null.
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* noop */
    }
    setShow(false);
  };

  const save = () => {
    if (!choice) return;
    setCountry(choice);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* noop */
    }
    setShow(false);
  };

  return (
    <div
      className="relative rounded-2xl border border-border bg-card p-4"
      data-testid="home-country-prompt"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss country prompt"
        className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="text-sm font-semibold">Which country do you call home? 🌍</p>
      <p className="mt-1 text-xs text-muted-foreground">
        we never guessed one for you — pick it and the right apps, currency and
        helplines show up. no cap.
      </p>
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value as "" | CountryCode)}
        aria-label="Home country"
        className="mt-3 w-full rounded-xl border border-border bg-input/40 px-3 py-2.5 text-sm outline-none focus:border-primary"
      >
        <option value="">Select a country</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.label}
          </option>
        ))}
      </select>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!choice}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
