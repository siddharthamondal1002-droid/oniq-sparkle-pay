// The job & gig app directory.
//
// Extracted from the standalone /app/jobs-apps route so Jobs is ONE screen.
// Two screens behind two identical 18+ gates, cross-linked to each other, was
// the same surface split in half: users had to know that "Jobs" meant the CV
// builder and "Job apps" meant the directory, and both tiles sat next to each
// other on the home grid saying almost the same word.
//
// The rules this directory enforces are unchanged by the move:
//  - 18+ only, gated by the parent screen (fail-closed `is_adult_18`).
//  - No third-party logos or wordmark images. Tiles are a letter + brand colour.
//  - ONIQ is not an employer, agency or partner. Nothing here is an endorsement.
//  - The scam warning is persistent and not dismissible — the FTC data it cites
//    describes the single biggest risk of this screen.
import { useMemo } from "react";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { COUNTRIES } from "@/lib/country";
import { launchAppEntry, readableInk } from "@/lib/miniapps";
import { visibleApps, type AppEntry, type Country } from "@/data/appRegistry";

export function JobAppsDirectory({
  target,
  setTarget,
}: {
  target: Country;
  setTarget: (c: Country) => void;
}) {
  const jobs = useMemo(() => visibleApps(target, "jobs"), [target]);
  const gigs = useMemo(() => visibleApps(target, "gig"), [target]);

  const official = jobs.filter((a) => a.government);
  const boards = jobs.filter((a) => !a.government);

  return (
    <div className="px-4">
      <ScamWarning />

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {COUNTRIES.map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => setTarget(c.code as Country)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              target === c.code
                ? "bg-[#00D4B8] font-semibold text-black"
                : "bg-white/5 text-white/70"
            }`}
          >
            {c.flag} {c.label}
          </button>
        ))}
      </div>

      <Section
        title="Government & official portals"
        note="Run by a public body. Applying is free."
        apps={official}
      />
      <Section
        title="Job boards & marketplaces"
        note="Private companies. ONIQ has no partnership with any of them."
        apps={boards}
      />
      <Section
        title="Gig, delivery & driver work"
        note="Onboarding usually needs ID, a bank account and, for driving, a licence."
        apps={gigs}
      />

      <p className="mt-8 text-xs leading-relaxed text-white/40">
        ONIQ is not an employer, recruiter or agency, and is not affiliated with any app listed
        here. Listings are shortcuts to each provider&apos;s own app or website — every application,
        contract and payment is between you and them. Names are used for identification only.
      </p>
    </div>
  );
}

/**
 * Persistent, non-dismissible. Figures are the FTC's reported losses to job and
 * business-opportunity scams (first half of 2024) and the rise of "task" scams.
 */
function ScamWarning() {
  return (
    <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div className="text-xs leading-relaxed text-amber-100">
          <p className="font-semibold">A real job never asks you to pay</p>
          <p className="mt-1 opacity-90">
            The US Federal Trade Commission recorded about $223 million lost to job and
            business-opportunity scams in the first half of 2024 alone. &ldquo;Task&rdquo; scams —
            you are paid small amounts to click or rate things, then asked to deposit your own money
            — went from essentially zero reports in 2020 to roughly 20,000 in that same half-year.
          </p>
          <ul className="mt-2 list-disc space-y-1 ps-4 opacity-90">
            <li>Never pay a registration, training, kit, visa or &ldquo;refundable&rdquo; fee.</li>
            <li>Never send crypto or top up a wallet to unlock earnings.</li>
            <li>Never hand over your ID, bank login or OTP over WhatsApp or Telegram.</li>
            <li>An offer with no interview, from a chat group, is not an offer.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Section({ title, note, apps }: { title: string; note: string; apps: AppEntry[] }) {
  if (apps.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-white/40">{note}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {apps.map((a) => (
          <AppTile key={a.id} app={a} />
        ))}
      </div>
    </section>
  );
}

function AppTile({ app }: { app: AppEntry }) {
  return (
    <button
      type="button"
      onClick={() => void launchAppEntry(app)}
      // Play requires it be obvious a tap leaves the app — in the accessible
      // name as well as on screen, so a screen-reader user is told too.
      aria-label={`Open ${app.name} — opens outside ONIQ`}
      className="flex items-start gap-3 rounded-2xl border border-white/10 bg-[#16181E] p-3 text-start"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold"
        style={{ background: app.color, color: readableInk(app.color) }}
      >
        {app.letter}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-sm font-semibold">
          <span className="truncate">{app.name}</span>
          {app.government ? <BadgeCheck className="size-3.5 shrink-0 text-[#00D4B8]" /> : null}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-white/50">{app.tagline}</span>
        <span className="mt-0.5 block text-[10px] text-white/35">Open in browser ↗</span>
        {app.freeToApply ? (
          <span className="mt-1 inline-block rounded-full bg-[#00D4B8]/15 px-2 py-0.5 text-[10px] font-medium text-[#00D4B8]">
            Free to apply
          </span>
        ) : (
          <span className="mt-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50">
            Fees or commission apply
          </span>
        )}
      </span>
    </button>
  );
}
