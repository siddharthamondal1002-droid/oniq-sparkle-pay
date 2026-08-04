// ONIQ Jobs App Directory — a country-aware index of real hiring, freelance
// and gig apps, deep-linked through the shared registry launcher.
//
// Rules this screen enforces:
//  - 18+ only. Job and gig onboarding is a child-labour surface, so it uses the
//    same fail-closed `is_adult_18` gate as the CV builder (18 everywhere, not
//    the lower digital-consent age).
//  - No third-party logos or wordmark images. Tiles are a letter + brand colour.
//  - ONIQ is not an employer, agency or partner. Nothing here is an endorsement.
//  - The scam warning is persistent — it is not dismissible, because the FTC
//    data it cites describes the single biggest risk of this screen.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, Briefcase, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { COUNTRIES, useCountry } from "@/lib/country";
import { getAgeGateStatus, setMyDateOfBirth } from "@/lib/ageGate";
import { launchAppEntry } from "@/lib/miniapps";
import { readableInk } from "@/lib/miniapps";
import { visibleApps, type AppEntry, type Country } from "@/data/appRegistry";

export const Route = createFileRoute("/_authenticated/app/jobs-apps")({
  head: () => ({
    meta: [
      { title: "Job & Gig Apps — ONIQ" },
      {
        name: "description",
        content:
          "A country-aware directory of real job boards, freelance marketplaces, government hiring portals and gig-work apps. Free to apply is labelled. 18+.",
      },
      { property: "og:title", content: "Job & Gig Apps — ONIQ" },
      {
        property: "og:description",
        content:
          "Open real hiring and gig apps for India, the US, UK, UAE, Canada, Australia and Singapore — with a plain-English scam warning.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JobsAppsScreen,
});

function JobsAppsScreen() {
  const [country] = useCountry();
  const [target, setTarget] = useState<Country>((country as Country) ?? "IN");

  const { data: gate, refetch } = useQuery({
    queryKey: ["age-gate-status"],
    queryFn: getAgeGateStatus,
    staleTime: 60_000,
  });

  const { data: isAdult, refetch: refetchAdult } = useQuery({
    queryKey: ["is-adult-18"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return false;
      const { data, error } = await supabase.rpc("is_adult_18" as never, {
        _uid: auth.user.id,
      } as never);
      if (error) return false;
      return data === true;
    },
    staleTime: 60_000,
  });

  return (
    <div className="min-h-dvh bg-[#0E0F13] pb-24 text-white">
      <header className="flex items-center gap-3 px-4 pt-5">
        <Link to="/app/jobs" className="rounded-full bg-white/5 p-2" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/40">
            the bag starts somewhere 💼
          </p>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Briefcase className="size-5 text-[#00D4B8]" /> Job & gig apps
          </h1>
        </div>
      </header>

      {isAdult === false ? (
        <AgeGate
          hasDob={gate?.has_dob ?? true}
          onSaved={async () => {
            await refetch();
            await refetchAdult();
          }}
        />
      ) : (
        <Directory target={target} setTarget={setTarget} />
      )}
    </div>
  );
}

/** 18+ everywhere, fail-closed, with a one-time DOB backfill for old accounts. */
function AgeGate({ hasDob, onSaved }: { hasDob: boolean; onSaved: () => void }) {
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-4 mt-6 rounded-2xl border border-white/10 bg-[#16181E] p-4">
      <h2 className="text-base font-semibold">Job and gig apps are for 18 and over</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/60">
        Signing up to work — especially delivery and driver work — is restricted to adults, so we
        hold this directory to 18 everywhere.
      </p>
      {hasDob ? (
        <p className="mt-3 text-sm text-white/50">
          Your account is under 18. Nothing here is available yet.
        </p>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-white/60">
            We do not have your date of birth on file, so access is closed. Add it once — it cannot
            be changed afterwards.
          </p>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!dob || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await setMyDateOfBirth(dob);
                toast.success("Date of birth saved");
                onSaved();
              } catch (e) {
                toast.error((e as Error)?.message ?? "Could not save that");
              } finally {
                setBusy(false);
              }
            }}
            className="mt-3 w-full rounded-xl bg-[#00D4B8] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save date of birth"}
          </button>
        </div>
      )}
    </div>
  );
}

function Directory({
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
