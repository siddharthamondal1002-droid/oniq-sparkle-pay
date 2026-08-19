import { createFileRoute, Link } from "@tanstack/react-router";
import { GRIEVANCE_OFFICER } from "@/config/privacy";
import {
  COUNTRIES_SUPPORTED,
  FEATURE_CARDS,
  HERO,
  AI_DISCLOSURE,
  MINI_APPS_LIVE,
  NOT_AFFILIATED,
  PRIVACY_BAND,
  SCOUT_LANGUAGES,
  WORLDS_LIVE,
  type FeatureCard,
} from "@/data/marketingCopy";
import {
  MessageCircle,
  Sparkles,

  Newspaper,
  Car,
  Plane,
  BookOpen,
  ShieldCheck,
  Globe2,
  ArrowRight,
  Zap,
} from "lucide-react";

const LANDING_DESCRIPTION =
  "Chat with voice and video, study for your boards, compare rides and travel, learn a language and ask an AI. One app for every world.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ONIQ — One App. Every World." },
      { name: "description", content: LANDING_DESCRIPTION },
      { property: "og:title", content: "ONIQ — One App. Every World." },
      { property: "og:description", content: LANDING_DESCRIPTION },
      { property: "og:url", content: "https://oniqhub.com/" },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "ONIQ — One App. Every World." },
      { name: "twitter:description", content: LANDING_DESCRIPTION },
    ],
  }),
  component: Landing,
});

// The feature list lives in src/data/marketingCopy.ts now, where the tests
// can check that every live card points at a route that exists.

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent glow text-primary-foreground font-bold">
              O
            </div>
            <span className="truncate font-display text-lg font-semibold tracking-tight">ONIQ</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#worlds" className="hover:text-foreground">Worlds</a>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <a href="#download" className="hover:text-foreground">Get the app</a>
          </nav>
          <Link
            to="/auth"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 sm:px-4"
          >
            <span className="whitespace-nowrap">Open app</span>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        </div>
        <nav className="flex items-center gap-5 overflow-x-auto px-4 pb-3 text-sm text-muted-foreground sm:px-5 md:hidden">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#worlds" className="hover:text-foreground">Worlds</a>
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <a href="#download" className="whitespace-nowrap hover:text-foreground">Get the app</a>
        </nav>
      </header>


      <main>
      {/* Hero */}
      <section className="relative overflow-hidden bg-hero">
        <div className="pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute top-40 -right-16 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-amber-400/15 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-5 pb-24 pt-20 md:pt-32">
          <div className="grid gap-12 md:grid-cols-[1.2fr_1fr] md:items-center">
            <div>
              {/*
                The app published to Google Play on 18 Aug 2026, so an
                early-access badge was stale the day it shipped. It now links
                to the listing.
              */}
              <a
                href={HERO.playUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/20"
              >
                <Zap className="h-3.5 w-3.5" />
                {HERO.badge}
              </a>
              <h1 className="mt-5 font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
                One app.
                <br />
                <span className="bg-gradient-to-r from-[#00D4B8] via-[#8B5CF6] to-[#F59E0B] bg-clip-text text-transparent">Every world.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">{HERO.body}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 glow"
                >
                  Create your account <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold hover:bg-muted"
                >
                  Explore worlds
                </a>
              </div>
              <div className="mt-3 text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link to="/auth" className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
                  Open app →
                </Link>
              </div>
              {/*
                Every number is counted, not inherited. "12 worlds" survived
                two surface removals unchanged, which is how a stat becomes a
                lie by attrition — WORLDS_LIVE is derived from the card list.
              */}
              <div className="mt-10 grid grid-cols-3 gap-6 text-sm">
                <Stat value={String(COUNTRIES_SUPPORTED)} label="Countries supported" />
                <Stat value={String(SCOUT_LANGUAGES)} label="Languages in Scout" />
                <Stat value={String(WORLDS_LIVE)} label="Worlds in one app" />
              </div>
            </div>

            <PhoneMockup />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{ scrollMarginTop: "5rem" }} className="mx-auto max-w-6xl px-5 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-4xl font-bold md:text-5xl">
            {WORLDS_LIVE} worlds. <span className="text-gradient-accent">One login.</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Stop juggling apps. ONIQ brings everyday life into a single, unified surface.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURE_CARDS.filter((c) => c.status === "live").map((c) => (
            <FeatureTile key={c.title} card={c} />
          ))}
        </div>

        {/*
          Coming soon, visibly so. Dimmed, badged, and rendered as a <div>
          rather than a link — a card that looks live and is not is worse than
          no card, and worst of all for a payment feature.
        */}
        <div className="mt-14">
          <h3 className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Coming soon
          </h3>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURE_CARDS.filter((c) => c.status === "soon").map((c) => (
              <FeatureTile key={c.title} card={c} />
            ))}
          </div>
        </div>
      </section>

      {/*
        THE PRIVACY BAND. Read src/data/marketingCopy.ts → PRIVACY_BAND before
        editing a word of this. The version in the original copy deck claimed
        health logs were "encrypted on your device. Not on our servers." That
        was false — Vitals writes to Postgres — and it would have put a false
        statement about sensitive personal data on the front page. Every clause
        below is checkable.
      */}
      <section className="border-y border-border bg-[image:var(--gradient-card)]">
        <div className="mx-auto max-w-4xl px-5 py-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <ShieldCheck className="h-3.5 w-3.5" /> Privacy
          </div>
          <h2 className="mt-5 font-display text-3xl font-bold leading-tight md:text-4xl">
            {PRIVACY_BAND.heading}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-muted-foreground">{PRIVACY_BAND.body}</p>
        </div>
      </section>

      {/* AI disclosure — see AI_DISCLOSURE in src/data/marketingCopy.ts */}
      <section className="mx-auto max-w-4xl px-5 py-16">
        <div className="rounded-2xl border border-border bg-card/50 p-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> {AI_DISCLOSURE.heading}
          </div>
          <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
            {AI_DISCLOSURE.points.map((p) => (
              <li key={p} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Worlds split */}
      <section id="worlds" style={{ scrollMarginTop: "5rem" }} className="border-y border-border bg-surface/40">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 md:grid-cols-2 md:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs">
              <Globe2 className="h-3.5 w-3.5 text-primary" /> Global by default
            </div>
            <h2 className="mt-4 font-display text-4xl font-bold md:text-5xl">
              Built for the
              <br /> <span className="text-gradient-primary">connected world.</span>
            </h2>
            <p className="mt-5 text-muted-foreground">
              Multi-language, multi-provider, multi-everything. Whether you're sending a
              voice note across timezones or revising for a board exam — ONIQ
              just works.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <Check>Real-time voice &amp; video calls in chat</Check>
              <Check>RLS-enforced data — every write checked server-side</Check>
              <Check>Installable as a PWA with custom wallpapers &amp; skins</Check>
              <Check>{MINI_APPS_LIVE} mini apps, one login, no re-auth</Check>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <WorldCard icon={MessageCircle} label="Chat" tint="from-primary to-blue-500" />
            <WorldCard icon={Newspaper} label="Pulse" tint="from-neon to-primary" />
            <WorldCard icon={BookOpen} label="Study" tint="from-magenta to-primary" />
            <WorldCard icon={Sparkles} label="Ting AI" tint="from-primary to-magenta" />
            <WorldCard icon={Plane} label="Wanderlust" tint="from-amber to-magenta" />
            <WorldCard icon={Car} label="Ride" tint="from-primary to-neon" />
          </div>
        </div>
      </section>
      </main>

      {/* Footer */}
      <footer id="download" style={{ scrollMarginTop: "5rem" }} className="border-t border-border">

        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-12 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent glow text-primary-foreground font-bold text-xl">
            O
          </div>
          <p className="font-display text-2xl font-semibold">One app. Every world.</p>
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Get started — it's free
          </Link>
          <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
            {/*
              Child Safety and Delete Account were public routes that nothing
              linked to. Play wants an account-deletion URL a reviewer can
              reach without installing the app, and the child-safety policy is
              a condition of the social features — an unlinked page satisfies
              neither.
            */}
            <Link to="/terms" className="hover:text-primary">Terms</Link>
            <span>·</span>
            <Link to="/privacy" className="hover:text-primary">Privacy</Link>
            <span>·</span>
            <Link to="/child-safety" className="hover:text-primary">Child Safety</Link>
            <span>·</span>
            <Link to="/delete-account" className="hover:text-primary">Delete Account</Link>
            <span>·</span>
            <Link to="/dmca" className="hover:text-primary">Copyright</Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Grievance Officer: {GRIEVANCE_OFFICER.name} —{" "}
            <a href={`mailto:${GRIEVANCE_OFFICER.email}`} className="hover:text-primary">
              {GRIEVANCE_OFFICER.email}
            </a>
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-[11px] leading-relaxed text-muted-foreground/80">
            {NOT_AFFILIATED}
          </p>
          {/*
            DMCA.com Protection Status badge (Pro). Hotlinked on purpose: the
            image is served by dmca.com against the protection ID, so it cannot
            be faked and it stops asserting protection if the subscription
            lapses. Self-hosting the PNG would keep claiming it forever.

            The supplied snippet also loads
            https://images.dmca.com/Badges/DMCABadgeHelper.min.js — omitted.
            The badge links and renders without it; the helper only adds
            click-through wiring. A third-party SCRIPT is a different order of
            risk from a third-party image: it executes in the page with full DOM
            access, on an app carrying a consent ledger and health data. Say the
            word and it goes in, but it would then need disclosing in Play Data
            safety alongside the image.

            Two things this badge is not: a U.S. Copyright Office §512(c)(2)
            agent designation, and any kind of safe harbour. /dmca states
            ONIQ's actual position.

            The image request still carries the viewer's IP to dmca.com —
            declare it in Data safety. referrerPolicy keeps the page URL out.
          */}
          <a
            href="https://www.dmca.com/Protection/Status.aspx?ID=1cdf7ab8-a10a-404c-a1f9-7f651e746222"
            title="DMCA.com Protection Status"
            target="_blank"
            rel="noopener noreferrer"
            className="dmca-badge mt-4 inline-block opacity-70 transition-opacity hover:opacity-100"
          >
            <img
              src="https://images.dmca.com/Badges/DMCA_logo-bw180w.png?ID=1cdf7ab8-a10a-404c-a1f9-7f651e746222"
              alt="DMCA.com Protection Status"
              width={180}
              height={40}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </a>
          <p className="mt-2 text-xs text-muted-foreground">
            © {new Date().getFullYear()} ONIQ. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * One feature card. `soon` cards are deliberately a different object: dimmed,
 * badged, and not a link, so the difference survives a glance rather than
 * needing to be read.
 */
function FeatureTile({ card }: { card: FeatureCard }) {
  const soon = card.status === "soon";
  return (
    <div
      className={`group relative overflow-hidden rounded-3xl border p-6 transition-all duration-300 ${
        soon
          ? "border-dashed border-border/70 bg-muted/20 opacity-60"
          : "border-border bg-[image:var(--gradient-card)] hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_10px_40px_-10px_hsl(var(--primary)/0.35)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">{card.title}</h3>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {soon && (
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Coming soon
            </span>
          )}
          {card.adultOnly && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
              18+
            </span>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{card.copy}</p>
      {!soon && (
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 opacity-0 blur-2xl transition group-hover:opacity-100" />
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-display text-3xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}

function WorldCard({
  icon: Icon,
  label,
  tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tint: string;
}) {
  return (
    <div className={`rounded-2xl border border-border bg-gradient-to-br ${tint} p-5 text-primary-foreground shadow-card`}>
      <Icon className="h-7 w-7" />
      <div className="mt-8 font-display text-lg font-semibold">{label}</div>
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className="relative mx-auto h-[520px] w-[260px] animate-float-slow">
      <div className="absolute inset-0 rounded-[3rem] border border-border bg-surface shadow-card glow" />
      <div className="absolute inset-2 overflow-hidden rounded-[2.6rem] bg-background">
        <div className="bg-hero px-5 pt-12">
          <div className="text-xs text-muted-foreground">Good morning</div>
          <div className="font-display text-2xl font-bold">Alex</div>
          <div className="mt-4 rounded-2xl border border-border bg-card/70 p-4 backdrop-blur">
            <div className="text-xs text-muted-foreground">Study</div>
            <div className="mt-1 font-display text-2xl font-semibold">Papers ready 📚</div>
            <div className="mt-2 text-xs text-neon">Your board · Your class · Print it</div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            {["Chat", "Study", "Ting", "Ride"].map((t) => (
              <div
                key={t}
                className="rounded-xl border border-border bg-card/50 py-3 text-xs text-muted-foreground"
              >
                {t}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-border bg-card/70 p-4">
            <div className="flex items-center gap-2 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span className="font-medium">Ting AI</span>
            </div>
            <div className="mt-2 text-sm">"Ting, what's the cheapest ride to Park Street rn?"</div>
          </div>
        </div>
      </div>
    </div>
  );
}
