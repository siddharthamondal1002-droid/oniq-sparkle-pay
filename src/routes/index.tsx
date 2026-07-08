import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MessageCircle,
  Wallet,
  UtensilsCrossed,
  Sparkles,
  CloudSun,
  Coins,
  ShieldCheck,
  Globe2,
  ArrowRight,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ONIQ — One App. Every World." },
      {
        name: "description",
        content:
          "The global lifestyle super app. Chat, pay, eat, invest, and create — all from one login. Built for the connected world.",
      },
      { property: "og:title", content: "ONIQ — One App. Every World." },
      {
        property: "og:description",
        content:
          "Messaging, social, food, payments, crypto, AI and more — in a single super app.",
      },
      { property: "og:url", content: "https://oniq-sparkle-pay.lovable.app/" },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "ONIQ — One App. Every World." },
      {
        name: "twitter:description",
        content:
          "Messaging, social, food, payments, crypto, AI and more — in a single super app.",
      },
    ],
    links: [{ rel: "canonical", href: "https://oniq-sparkle-pay.lovable.app/" }],
  }),
  component: Landing,
});


const features = [
  { icon: MessageCircle, title: "Messaging", desc: "Real-time chat, voice & video. End-to-end and lightning fast." },
  { icon: Sparkles, title: "Moments & Channels", desc: "Share moments with friends, follow creators, go live." },
  { icon: UtensilsCrossed, title: "Food Delivery", desc: "Order from local restaurants — alcohol-free, family-safe." },
  { icon: Coins, title: "OMIQ Wallet", desc: "Built-in crypto wallet on Polygon. Your keys, your coins." },
  { icon: Sparkles, title: "AI Assistant", desc: "On-demand AI for chat, search, planning and creativity." },
  { icon: CloudSun, title: "Weather & Travel", desc: "Hyperlocal forecasts and trip tools in one tap." },
  { icon: ShieldCheck, title: "Fraud Protection", desc: "AI-powered fraud detection on every transaction." },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 glass">
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
            <a href="#pay" className="hover:text-foreground">ONIQ Pay</a>
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

        <div className="mx-auto max-w-6xl px-5 pb-24 pt-20 md:pt-32">
          <div className="grid gap-12 md:grid-cols-[1.2fr_1fr] md:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground">
                <Zap className="h-3.5 w-3.5 text-primary" />
                Now in early access
              </div>
              <h1 className="mt-5 font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
                One app.
                <br />
                <span className="text-gradient-primary">Every world.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                ONIQ is the global lifestyle super app. Chat with friends, pay anyone,
                order food, hold crypto, and ask an AI — all from a single, beautifully
                fast experience.
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
              <div className="mt-10 grid grid-cols-3 gap-6 text-sm">
                <Stat value="9" label="Worlds in one app" />
                <Stat value="0$" label="Free for users" />
                <Stat value="180+" label="Countries planned" />
              </div>
            </div>

            <PhoneMockup />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-4xl font-bold md:text-5xl">
            Eight worlds. <span className="text-gradient-accent">One login.</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Stop juggling apps. ONIQ brings everyday life into a single, unified surface.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="group relative overflow-hidden rounded-3xl border border-border bg-[image:var(--gradient-card)] p-6 transition hover:border-primary/40"
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
      <section id="worlds" className="border-y border-border bg-surface/40">
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
              Multi-currency. Multi-language. Multi-everything. Whether you're sending a
              voice note across timezones or splitting dinner across currencies — ONIQ
              just works.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <Check>End-to-end encrypted messaging</Check>
              <Check>Biometric authentication on every payment</Check>
              <Check>RLS-enforced data, zero shared inboxes</Check>
              <Check>Alcohol-free food marketplace, family-safe</Check>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <WorldCard icon={MessageCircle} label="Chat" tint="from-primary to-blue-500" />
            <WorldCard icon={Wallet} label="Pay" tint="from-accent to-amber" />
            <WorldCard icon={UtensilsCrossed} label="Food" tint="from-neon to-primary" />
            <WorldCard icon={Coins} label="Crypto" tint="from-amber to-magenta" />
            <WorldCard icon={Sparkles} label="AI" tint="from-magenta to-primary" />
            <WorldCard icon={CloudSun} label="Weather" tint="from-primary to-neon" />
          </div>
        </div>
      </section>

      {/* Pay CTA */}
      <section id="pay" className="mx-auto max-w-6xl px-5 py-24">
        <div className="relative overflow-hidden rounded-[2.5rem] border border-border bg-[image:var(--gradient-card)] p-10 md:p-16">
          <div className="absolute inset-0 bg-hero opacity-60" aria-hidden />
          <div className="relative grid gap-8 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="font-display text-4xl font-bold md:text-5xl">
                Send money like a
                <br />
                <span className="text-gradient-accent">text message.</span>
              </h2>
              <p className="mt-4 max-w-md text-muted-foreground">
                ONIQ Pay is free, instant, and global. Drop money in a chat, split a bill
                with a tap, or stash savings in OMIQ.
              </p>
              <Link
                to="/auth"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition hover:opacity-90 glow-magenta"
              >
                Open ONIQ Pay <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <RedPacketCard />
          </div>
        </div>
      </section>
      </main>

      {/* Footer */}
      <footer id="download" className="border-t border-border">

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
          <p className="mt-4 text-xs text-muted-foreground">
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
            <div className="text-xs text-muted-foreground">ONIQ Pay balance</div>
            <div className="mt-1 font-display text-2xl font-semibold">$1,284.50</div>
            <div className="mt-2 text-xs text-neon">+ 124 OMIQ</div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            {["Chat", "Pay", "Eat", "AI"].map((t) => (
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
              <span className="font-medium">ONIQ AI</span>
            </div>
            <div className="mt-2 text-sm">Want me to book your usual ramen for 7pm?</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RedPacketCard() {
  return (
    <div className="relative mx-auto w-full max-w-sm rounded-3xl border border-border bg-gradient-to-br from-accent to-destructive p-6 text-primary-foreground shadow-card glow-magenta">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest opacity-80">
        <Wallet className="h-4 w-4" /> Red packet
      </div>
      <div className="mt-6 font-display text-5xl font-bold">$88.88</div>
      <div className="mt-1 text-sm opacity-80">From Maya · "Happy birthday 🎉"</div>
      <button className="mt-6 w-full rounded-full bg-background/90 py-2.5 text-sm font-semibold text-foreground hover:bg-background">
        Claim
      </button>
    </div>
  );
}
