import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MessageCircle,
  Sparkles,
  Wallet,
  QrCode,
  Car,
  Plane,
  Languages,
  Tv,
  Film,
  Grid3x3,
  ShieldCheck,
  Globe2,
  ArrowRight,
  Zap,
} from "lucide-react";


const LANDING_DESCRIPTION =
  "Chat, pay, watch live TV, ride, travel, learn — ONIQ is one app for every world.";

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


const features = [
  { icon: MessageCircle, title: "Chat", desc: "Real-time messaging with voice & video calls." },
  { icon: Sparkles, title: "Moments", desc: "A private social feed for you and your circle." },
  { icon: Film, title: "Clips", desc: "Endless short videos in a swipeable feed." },
  { icon: Wallet, title: "Wallet & Red Packets", desc: "Instant send/request plus 🧧 red packets with escrow." },
  { icon: QrCode, title: "Scan & Pay (UPI)", desc: "Scan any UPI QR, show your own, pay in a tap." },
  { icon: Car, title: "Ride Genie", desc: "Compare ride prices across providers before you book." },
  { icon: Plane, title: "Wander", desc: "Compare buses, trains, flights and hotels in one hub." },
  { icon: Sparkles, title: "Ting AI", desc: "Live-web AI assistant that actually answers what's happening now." },
  { icon: Languages, title: "Lingo", desc: "25-language translator plus Bengali lessons in ONIQ Learn." },
  { icon: Tv, title: "Pulse & Watch", desc: "Live news TV, 6 genre channels, plus My TV for your YouTube picks." },
  { icon: Grid3x3, title: "25+ Mini Apps", desc: "A growing hub of partner apps that open right inside ONIQ." },
  { icon: ShieldCheck, title: "Yours to skin", desc: "Install as a PWA, add wallpapers and tile skins." },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent glow text-primary-foreground font-bold">
              O
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">ONIQ</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#worlds" className="hover:text-foreground">Worlds</a>
            <a href="#download" className="hover:text-foreground">Get the app</a>
          </nav>
          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Open app <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
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
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Zap className="h-3.5 w-3.5" />
                Now in early access ⚡
              </div>
              <h1 className="mt-5 font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
                One app.
                <br />
                <span className="bg-gradient-to-r from-[#00D4B8] via-[#8B5CF6] to-[#F59E0B] bg-clip-text text-transparent">Every world.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                Chat with voice &amp; video, send money, scan any UPI QR, compare rides
                and travel, watch live TV, learn a language and ask an AI — all in one
                beautifully fast app.
              </p>
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
              <div className="mt-10 grid grid-cols-3 gap-6 text-sm">
                <Stat value="12" label="Worlds in one app" />
                <Stat value="25" label="Languages in Lingo" />
                <Stat value="6" label="TV genres live" />
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
            Twelve worlds. <span className="text-gradient-accent">One login.</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Stop juggling apps. ONIQ brings everyday life into a single, unified surface.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="group relative overflow-hidden rounded-3xl border border-border bg-[image:var(--gradient-card)] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_10px_40px_-10px_hsl(var(--primary)/0.35)]"
            >
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 opacity-0 blur-2xl transition group-hover:opacity-100" />
            </div>
          ))}
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
              voice note across timezones or splitting a red packet with friends — ONIQ
              just works.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <Check>Real-time voice &amp; video calls in chat</Check>
              <Check>RLS-enforced data — every wallet write server-signed</Check>
              <Check>Installable as a PWA with custom wallpapers &amp; skins</Check>
              <Check>25+ mini apps, one login, no re-auth</Check>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <WorldCard icon={MessageCircle} label="Chat" tint="from-primary to-blue-500" />
            <WorldCard icon={Wallet} label="Pay" tint="from-neon to-primary" />
            <WorldCard icon={Tv} label="Watch" tint="from-magenta to-primary" />
            <WorldCard icon={Sparkles} label="Ting AI" tint="from-primary to-magenta" />
            <WorldCard icon={Plane} label="Wander" tint="from-amber to-magenta" />
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
            <Link to="/terms" className="hover:text-primary">Terms</Link>
            <span>·</span>
            <Link to="/privacy" className="hover:text-primary">Privacy</Link>
            <span>·</span>
            <a href="mailto:grievance@oniqhub.com" className="hover:text-primary">Grievance officer</a>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            © {new Date().getFullYear()} ONIQ. All rights reserved.
          </p>
        </div>
      </footer>
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
            <div className="text-xs text-muted-foreground">Wallet balance</div>
            <div className="mt-1 font-display text-2xl font-semibold">$1,284.50</div>
            <div className="mt-2 text-xs text-neon">Send · Request · 🧧 Red Packet</div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            {["Chat", "Pay", "Watch", "Ride"].map((t) => (
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
