import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink, Landmark, Phone, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { openInApp } from "@/lib/miniapps";
import { COUNTRIES, useCountry } from "@/lib/country";
import { resolveTileLabel } from "@/lib/i18n/tileLabel";
import { useT } from "@/lib/i18n/LanguageProvider";
import {
  OniqCanvas,
  OniqCard,
  OniqChip,
  OniqEmpty,
  OniqHeader,
  OniqSectionHeader,
} from "@/components/oniq";
import {
  OFFICIAL_LINKS,
  OFFICIAL_CATEGORY_LABELS,
  HELPLINES,
  isAllowedGovHost,
  hostOf,
  type OfficialLink,
} from "@/data/officialLinks";

export const Route = createFileRoute("/_authenticated/app/official")({
  component: OfficialScreen,
});

/**
 * Government & visa directory. Neutral icons only — no State Emblem, no
 * Ashoka Chakra, no government logos (State Emblem of India (Prohibition of
 * Improper Use) Act, 2005). Every outbound link passes the host allowlist
 * and opens behind an interstitial in a Custom Tab — never framed in ONIQ.
 */
function OfficialScreen() {
  const [country, setCountry] = useCountry();
  const { lang } = useT();
  const [confirming, setConfirming] = useState<OfficialLink | null>(null);

  const links = useMemo(() => OFFICIAL_LINKS.filter((l) => l.country === country), [country]);
  const partners = links.filter((l) => l.kind === "partner");
  const sections = OFFICIAL_CATEGORY_LABELS.map((cat) => ({
    ...cat,
    items: links.filter((l) => l.category === cat.id && l.kind === "gov"),
  })).filter((s) => s.items.length > 0);
  const helplines = HELPLINES[country] ?? [];

  function requestOpen(link: OfficialLink) {
    // Belt-and-braces: gov rows must pass the allowlist even if the data
    // file were edited badly. Partners are exempt but clearly labelled.
    if (link.kind === "gov" && !isAllowedGovHost(link.url)) {
      toast.error("Blocked: that link is not an official government domain");
      return;
    }
    setConfirming(link);
  }

  function confirmOpen() {
    if (!confirming) return;
    const link = confirming;
    setConfirming(null);
    void openInApp(link.url);
  }

  return (
    <OniqCanvas world="official" className="pb-10">
      <OniqHeader
        eyebrow="Official"
        title={resolveTileLabel(lang, "Official 🏛️", "सरकारी 🏛️")}
        subtitle={resolveTileLabel(
          lang,
          "government services & visas — official sites only",
          "सरकारी सेवाएँ और वीज़ा — केवल आधिकारिक साइटें",
        )}
        back="/app"
      >
        {/* Country selector — lists below re-render instantly */}
        <div
          className="snap-rail -mx-5 gap-2 px-5"
          role="group"
          aria-label="Country"
          data-testid="official-country-picker"
        >
          {COUNTRIES.map((c) => (
            <OniqChip key={c.code} active={country === c.code} onClick={() => setCountry(c.code)}>
              {c.flag} {c.code}
            </OniqChip>
          ))}
        </div>
      </OniqHeader>

      {/* Trust — what actually protects every tap below. Neutral icon only. */}
      <div className="mt-5 px-5 rise rise-1">
        <OniqCard variant="hero" padding="md">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/15">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="font-display text-[13px]">Official sites only</div>
              <p className="mt-1 text-[12px] leading-snug text-white/85">
                Every government link is checked against an allowlist of government domains before
                it opens, and you see the exact address first.
              </p>
            </div>
          </div>
        </OniqCard>
      </div>

      {/* Helplines — tap to call */}
      {helplines.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 px-5">
          {helplines.map((h) => (
            <a
              key={h.number}
              href={`tel:${h.number}`}
              className="press inline-flex items-center gap-1.5 rounded-full oniq-surface px-3 py-1.5 text-xs font-semibold text-foreground"
            >
              <Phone className="h-3.5 w-3.5 text-world" /> {h.label}: {h.number}
            </a>
          ))}
        </div>
      )}

      {/* Standing anti-fraud note (visa scams) */}
      <div className="mt-4 px-5">
        <div className="flex items-start gap-2 rounded-3xl border border-amber/60 bg-card p-3 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
          <p>
            Government e-visa portals need{" "}
            <span className="font-semibold text-foreground">no agent</span>. Any site promising
            "guaranteed" or "instant" visas, or asking to be paid by UPI, wallet or personal
            transfer, is fraudulent. Official fees are paid on the government site itself.
          </p>
        </div>
      </div>

      {/* Government sections */}
      {sections.map((s, si) => (
        <section key={s.id} className={`mt-6 ${si < 3 ? `rise rise-${si + 2}` : ""}`}>
          <OniqSectionHeader
            eyebrow={si === 0 ? "Government" : undefined}
            title={resolveTileLabel(lang, s.label, s.labelHi)}
          />
          <ul className="mt-3 grid gap-2 px-5">
            {s.items.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => requestOpen(l)}
                  data-testid={`official-${l.id}`}
                  className="press flex w-full items-center gap-3 rounded-3xl oniq-surface p-3 text-start"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-world-soft text-world">
                    <Landmark className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[13px] text-foreground">
                      {l.name}
                    </span>
                    <span className="block truncate text-[11px] font-normal normal-case text-muted-foreground">
                      {l.desc}
                    </span>
                    {isAllowedGovHost(l.url) && (
                      <span className="mt-1 flex items-center gap-1 text-[11px] font-medium normal-case text-world">
                        <ShieldCheck className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          Verified government domain · {hostOf(l.url)}
                        </span>
                      </span>
                    )}
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {sections.length === 0 && (
        <div className="mt-8 px-5">
          <OniqEmpty
            emoji="🏛️"
            title="nothing listed for this country yet — switch country above ✨"
          />
        </div>
      )}

      {/* Outsourcing partners — distinct treatment, never the government badge */}
      {partners.length > 0 && (
        <section className="mt-8">
          <OniqSectionHeader
            eyebrow={<span className="text-amber">Partner</span>}
            title="Official partner — not a government site"
          />
          <p className="mt-1 px-5 text-[11px] text-muted-foreground">
            Appointed visa-application contractors. Legitimate, but always confirm the embassy
            directs you there before paying.
          </p>
          <ul className="mt-3 grid gap-2 px-5">
            {partners.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => requestOpen(l)}
                  data-testid={`official-${l.id}`}
                  className="press flex w-full items-center gap-3 rounded-3xl border border-dashed border-amber/60 bg-card p-3 text-start"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber/10 text-amber">
                    <ExternalLink className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[13px] text-foreground">
                      {l.name}
                    </span>
                    <span className="block truncate text-[11px] font-normal normal-case text-muted-foreground">
                      {l.desc}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[11px] font-medium normal-case text-amber">
                      <ShieldAlert className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        Partner domain — not government · {hostOf(l.url)}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 px-5 text-center text-[11px] text-muted-foreground">
        ONIQ is not affiliated with, endorsed by, or acting on behalf of any government. Links open
        the official websites in your browser.
      </p>

      {/* Interstitial — always shows the exact destination host */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 pb-8"
          onClick={() => setConfirming(null)}
        >
          <div
            data-testid="official-interstitial"
            role="dialog"
            aria-modal="true"
            aria-label="Leaving ONIQ"
            className="w-full max-w-md rounded-3xl oniq-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong"
              aria-hidden="true"
            />
            <h3 className="font-display text-[18px] text-foreground">leaving ONIQ 🌐</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              You're leaving ONIQ to open{" "}
              <span className="break-all font-semibold text-foreground">
                {hostOf(confirming.url)}
              </span>
              {confirming.kind === "gov"
                ? " — official government site."
                : " — an appointed partner, NOT a government site."}
            </p>
            <div
              className={`mt-3 flex items-center gap-2 rounded-2xl p-3 text-[12px] font-medium ${
                confirming.kind === "gov"
                  ? "bg-world-soft text-world"
                  : "border border-dashed border-amber/60 bg-amber/10 text-amber"
              }`}
            >
              {confirming.kind === "gov" ? (
                <ShieldCheck className="h-4 w-4 shrink-0" />
              ) : (
                <ShieldAlert className="h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 truncate">
                {confirming.kind === "gov"
                  ? "Verified government domain"
                  : "Partner domain — not government"}{" "}
                · {hostOf(confirming.url)}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="press rounded-2xl border border-border-strong bg-background py-3 text-sm font-semibold text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="official-confirm-open"
                onClick={confirmOpen}
                className="press rounded-2xl bg-world py-3 text-sm font-semibold text-white"
              >
                Open site
              </button>
            </div>
          </div>
        </div>
      )}
    </OniqCanvas>
  );
}
