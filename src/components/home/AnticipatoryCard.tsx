/**
 * Loop 2 — the single anticipatory card on the home screen.
 *
 * Renders nothing unless: personalisation consent is granted, the user's own
 * signals satisfy a rule in `@/lib/adaptive`, and the card has not been
 * dismissed recently. It never acts on the user's behalf — it is a shortcut
 * plus the sentence explaining why it appeared.
 */
import { tileName } from "@/lib/i18n/tileLabel";
import { useT } from "@/lib/i18n/LanguageProvider";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { bandLabel, pickSuggestion, type Signal, type Suggestion } from "@/lib/adaptive";
import {
  getPersonalisationConsent,
  listMySignals,
  recordSignal,
} from "@/lib/personalisation";
import { rememberValue } from "@/lib/memory";

export function AnticipatoryCard() {
  const navigate = useNavigate();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [gone, setGone] = useState(false);
  const [why, setWhy] = useState(false);
  const { lang } = useT();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!(await getPersonalisationConsent())) return;
        const signals = (await listMySignals(400)) as unknown as Signal[];
        if (!alive) return;
        const picked = pickSuggestion(signals);
        setSuggestion(picked);
        if (picked) {
          // Loop 3: keep what we worked out, so it is inspectable and correctable
          // in Profile → Privacy instead of living only in this render.
          void rememberValue("favourite_hub", picked.label);
          void rememberValue("usual_time_band", bandLabel(new Date().getHours()));
        }
      } catch {
        /* a suggestion failing is never an error the user should see */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);


  if (!suggestion || gone) return null;

  const open = () => {
    void recordSignal("card_tap", suggestion.hub);
    setGone(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate({ to: suggestion.to as any, search: suggestion.search as any });
  };

  const dismiss = () => {
    void recordSignal("card_dismiss", suggestion.hub);
    setGone(true);
  };

  const name = suggestion.tile ? tileName(lang, suggestion.tile) : suggestion.label;

  return (
    <div className="mt-3 rounded-2xl border border-border bg-card/85 p-3 fade-up">
      <div className="flex items-center gap-2">
        <button
          onClick={open}
          className="press flex-1 text-left"
          aria-label={`Open ${name}`}
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            picking up where you left off
          </div>
          <div className="font-display text-sm font-semibold">
            Jump back into {name}
          </div>
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss suggestion"
          className="press grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <button
        onClick={() => setWhy((v) => !v)}
        className="mt-1 text-[11px] text-muted-foreground underline underline-offset-2"
      >
        {why ? "hide" : "why am I seeing this?"}
      </button>
      {why && (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {suggestion.reason} Only your own activity on this account is used. You
          can turn this off in Profile → Privacy → your data.
        </p>
      )}
    </div>
  );
}
