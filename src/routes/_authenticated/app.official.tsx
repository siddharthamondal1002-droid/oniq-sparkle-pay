import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Landmark, Phone, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { openInApp } from "@/lib/miniapps";
import { COUNTRIES, useCountry } from "@/lib/country";
import { resolveTileLabel } from "@/lib/i18n/tileLabel";
import { useT } from "@/lib/i18n/LanguageProvider";
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
    <div className="px-5 pt-12 pb-10">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold">
            {resolveTileLabel(lang, "Official 🏛️", "सरकारी 🏛️")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {resolveTileLabel(
              lang,
              "government services & visas — official sites only",
              "सरकारी सेवाएँ और वीज़ा — केवल आधिकारिक साइटें",
            )}
          </p>
        </div>
      </div>

      {/* Country selector — lists below re-render instantly */}
      <div
        className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto"
        data-testid="official-country-picker"
      >
        {COUNTRIES.map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => setCountry(c.code)}
            aria-pressed={country === c.code}
            className={`press shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
              country === c.code
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            {c.flag} {c.code}
          </button>
        ))}
      </div>

      {/* Helplines — tap to call */}
      {helplines.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {helplines.map((h) => (
            <a
              key={h.number}
              href={`tel:${h.number}`}
              className="press inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold"
            >
              <Phone className="h-3.5 w-3.5 text-primary" /> {h.label}: {h.number}
            </a>
          ))}
        </div>
      )}

      {/* Standing anti-fraud note (visa scams) */}
      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-card p-3 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p>
          Government e-visa portals need{" "}
          <span className="font-semibold text-foreground">no agent</span>. Any site promising
          "guaranteed" or "instant" visas, or asking to be paid by UPI, wallet or personal transfer,
          is fraudulent. Official fees are paid on the government site itself.
        </p>
      </div>

      {/* Government sections */}
      {sections.map((s) => (
        <section key={s.id} className="mt-6">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {resolveTileLabel(lang, s.label, s.labelHi)}
          </h2>
          <ul className="mt-2 space-y-2">
            {s.items.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => requestOpen(l)}
                  data-testid={`official-${l.id}`}
                  className="press flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Landmark className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{l.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {l.desc}
                    </span>
                    <span className="block truncate text-[11px] text-primary/80">
                      {hostOf(l.url)}
                    </span>
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {sections.length === 0 && (
        <div className="mt-8 rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
          nothing listed for this country yet — switch country above ✨
        </div>
      )}

      {/* Outsourcing partners — distinct treatment, never the government badge */}
      {partners.length > 0 && (
        <section className="mt-8">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-amber-500">
            Official partner — not a government site
          </h2>
          <p className="mt-1 px-1 text-[11px] text-muted-foreground">
            Appointed visa-application contractors. Legitimate, but always confirm the embassy
            directs you there before paying.
          </p>
          <ul className="mt-2 space-y-2">
            {partners.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => requestOpen(l)}
                  data-testid={`official-${l.id}`}
                  className="press flex w-full items-center gap-3 rounded-2xl border border-dashed border-amber-500/40 bg-card p-3 text-left"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-500">
                    <ExternalLink className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{l.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {l.desc}
                    </span>
                    <span className="block truncate text-[11px] text-amber-500/80">
                      {hostOf(l.url)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-center text-[11px] text-muted-foreground">
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
            className="w-full max-w-md rounded-3xl border border-border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-lg font-bold">leaving ONIQ 🌐</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              You're leaving ONIQ to open{" "}
              <span className="break-all font-semibold text-foreground">
                {hostOf(confirming.url)}
              </span>
              {confirming.kind === "gov"
                ? " — official government site."
                : " — an appointed partner, NOT a government site."}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="press rounded-2xl border border-border bg-background py-3 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="official-confirm-open"
                onClick={confirmOpen}
                className="press rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
              >
                Open site
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
