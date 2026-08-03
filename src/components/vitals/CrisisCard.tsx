// Country-aware crisis support card. Gentle by design: an offer, never an
// alarm. Free to reach — no paywall, no login gate, no onboarding step.
import { Link } from "@tanstack/react-router";
import { HeartHandshake, Phone } from "lucide-react";
import { useCountry } from "@/lib/country";
import { CRISIS_LINES, CRISIS_EMERGENCY } from "@/data/crisisLines";

export function CrisisCard({ intro }: { intro?: string }) {
  // TODO(current-region): these lines must follow where the user physically
  // IS, not their home country — an Indian user in Dubai needs the UAE lines
  // and UAE emergency number. `useCountry()` is the home/profile country and
  // is the only signal that exists today; swap it for a current-region signal
  // the moment one lands. No new location mechanism is invented here.
  const [country] = useCountry();
  const lines = CRISIS_LINES[country] ?? CRISIS_LINES.IN;
  const emergency = CRISIS_EMERGENCY[country] ?? "112";


  return (
    <div
      data-testid="crisis-card"
      role="region"
      aria-label="Support lines"
      className="rounded-2xl border border-primary/30 bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <HeartHandshake className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm font-semibold">you don't have to carry it alone 💙</p>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {intro ??
          "if things feel heavy, these lines are free, confidential and there for exactly this. talking to someone real helps."}
      </p>
      <ul className="mt-3 space-y-2">
        {lines.map((l) => (
          <li key={l.number}>
            <a
              href={`tel:${l.number}`}
              className="press flex items-center gap-3 rounded-xl border border-border bg-background p-3"
            >
              <Phone className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{l.name}</span>
                {l.note && (
                  <span className="block text-[11px] text-muted-foreground">{l.note}</span>
                )}
              </span>
              <span className="shrink-0 text-sm font-bold text-primary">
                {formatNumber(l.number)}
              </span>
            </a>
          </li>
        ))}
        <li>
          <a
            href={`tel:${emergency}`}
            className="press flex items-center gap-3 rounded-xl border border-border bg-background p-3"
          >
            <Phone className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <span className="flex-1 text-sm font-semibold">In immediate danger — emergency</span>
            <span className="shrink-0 text-sm font-bold text-destructive">{emergency}</span>
          </a>
        </li>
      </ul>
      <Link
        to="/app/safety-plan"
        className="press mt-3 block rounded-xl border border-dashed border-border p-3 text-center text-xs font-semibold text-foreground"
      >
        my safety plan →
      </Link>
    </div>
  );
}

function formatNumber(n: string): string {
  if (n === "116123") return "116 123";
  if (n === "131114") return "13 11 14";
  if (n === "18008914416") return "1800-891-4416";
  if (n === "1300224636") return "1300 22 4636";
  return n;
}
