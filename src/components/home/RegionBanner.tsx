// Shown once when the detected region disagrees with Home. It OFFERS local
// services — it never changes Home, and Home is never rewritten by detection.
// Dismissal is remembered for the trip (per detected region).
import { useState } from "react";
import { MapPin, X } from "lucide-react";
import { useCountry } from "@/lib/country";
import { useCurrentRegion, isRegionBannerDismissed, dismissRegionBanner } from "@/lib/region";
import { COUNTRIES } from "@/lib/country";
import { getCountryConfig } from "@/data/countryRegistry";

export function RegionBanner() {
  const [home] = useCountry();
  const [region] = useCurrentRegion();
  const [dismissed, setDismissed] = useState(false);

  if (!region || region === home) return null;
  if (dismissed || isRegionBannerDismissed(region)) return null;

  const label = COUNTRIES.find((c) => c.code === region)?.label ?? region;
  const flag = COUNTRIES.find((c) => c.code === region)?.flag ?? "📍";
  const cfg = getCountryConfig(region);

  return (
    <div
      role="status"
      aria-label={`Local services available in ${label}`}
      className="mt-3 flex items-start gap-3 rounded-2xl border border-border bg-card p-3"
    >
      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          looks like you&apos;re in {label} {flag}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          we&apos;ll use local emergency and support numbers (
          {cfg.emergency.unified ?? cfg.emergency.ambulance}) plus nearby rides and delivery. your
          home settings, language and content stay exactly as they are.
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss local services notice"
        onClick={() => {
          dismissRegionBanner(region);
          setDismissed(true);
        }}
        className="press shrink-0 rounded-lg p-1 text-muted-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
