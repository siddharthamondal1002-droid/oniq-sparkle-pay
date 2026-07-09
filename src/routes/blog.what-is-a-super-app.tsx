import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MessageCircle, Wallet, QrCode, Sparkles, ShieldCheck, Globe2 } from "lucide-react";

const TITLE = "What is a Super App? The Future of Unified Digital Living";
const DESCRIPTION =
  "A super app bundles chat, payments, food, rides, and mini apps into one login. Learn what a super app is, why WeChat, Grab, and Gojek dominate, and how ONIQ brings the model to a global audience.";
const URL = "https://oniqhub.com/blog/what-is-a-super-app";

export const Route = createFileRoute("/blog/what-is-a-super-app")({
  head: () => ({
    meta: [
      { title: `${TITLE} | ONIQ` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: TITLE,
          description: DESCRIPTION,
          author: { "@type": "Organization", name: "ONIQ" },
          publisher: { "@type": "Organization", name: "ONIQ" },
          mainEntityOfPage: URL,
          datePublished: "2026-07-09",
          dateModified: "2026-07-09",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "What is a super app?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "A super app is a single mobile application that bundles many everyday services — messaging, payments, food delivery, ride-hailing, ticketing, and third-party mini apps — behind one login, one wallet, and one identity.",
              },
            },
            {
              "@type": "Question",
              name: "What are examples of super apps?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "WeChat in China, Alipay, Grab in Southeast Asia, Gojek in Indonesia, Paytm and PhonePe in India, KakaoTalk in Korea, and Rappi in Latin America are the most widely used super apps today.",
              },
            },
            {
              "@type": "Question",
              name: "Why are super apps popular?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Super apps save phone storage, remove the need to re-enter payment and identity details for every service, and let users move between chat, payments, and commerce without switching context.",
              },
            },
            {
              "@type": "Question",
              name: "Is ONIQ a super app?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Yes. ONIQ combines chat, a funded wallet, UPI-style scan-and-pay, food ordering, rides, travel, live TV, an AI assistant, and a mini apps hub under one account.",
              },
            },
          ],
        }),
      },
    ],
  }),
  component: SuperAppGuide,
});

function SuperAppGuide() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link to="/" className="font-display text-lg font-bold tracking-tight">
            ONIQ
          </Link>
          <Link
            to="/auth"
            className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Try ONIQ <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-12">
        <nav aria-label="Breadcrumb" className="mb-6 text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">Home</Link>
          <span className="mx-2">/</span>
          <span>Blog</span>
          <span className="mx-2">/</span>
          <span className="text-foreground">What is a Super App?</span>
        </nav>

        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-primary">
          Guide · 8 min read
        </p>
        <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">
          What is a Super App? The Future of Unified Digital Living
        </h1>
        <p className="mt-5 text-lg text-muted-foreground">
          {DESCRIPTION}
        </p>

        <div className="prose prose-invert mt-10 max-w-none space-y-6 text-base leading-relaxed">
          <section>
            <h2 className="font-display text-2xl font-bold">Super app, defined</h2>
            <p>
              A <strong>super app</strong> is a single mobile application that combines many
              independently useful services — messaging, payments, commerce, transport, entertainment,
              and third-party <em>mini apps</em> — behind one account, one wallet, and one identity.
              The term was popularized by BlackBerry founder Mike Lazaridis in 2010 to describe
              WeChat, but the pattern has since spread across Asia, Latin America, Africa, and now
              global markets.
            </p>
            <p>
              Where a traditional app does one job well (a chat app chats, a bank app banks), a
              super app is a <strong>platform</strong>: the operator owns the shell, the identity
              layer, and the payment rails, while partners plug in services as mini apps that run
              inside the shell.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">The four pillars of every super app</h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Messaging as the front door.</strong> Chat keeps users returning daily and
                becomes the surface for payments, group buys, and customer support.
              </li>
              <li>
                <strong>An embedded wallet.</strong> One balance, one KYC, one tap to pay a person,
                a merchant, or a mini app — no card re-entry.
              </li>
              <li>
                <strong>A mini apps platform.</strong> Third parties ship lightweight experiences
                that run inside the shell, so users install nothing extra.
              </li>
              <li>
                <strong>One identity.</strong> A single verified account replaces dozens of logins
                and unlocks trust between services.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">Examples of super apps around the world</h2>
            <p>
              The category is no longer WeChat-only. Each region has produced a dominant super app,
              usually anchored on either messaging or payments:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li><strong>China:</strong> WeChat and Alipay — over a million mini programs each.</li>
              <li><strong>Southeast Asia:</strong> Grab and Gojek — ride-hailing that grew into wallets, food, and financial services.</li>
              <li><strong>India:</strong> Paytm and PhonePe, powered by UPI rails.</li>
              <li><strong>Korea:</strong> KakaoTalk — chat, taxis, banking, gifting.</li>
              <li><strong>Latin America:</strong> Rappi and Mercado Pago.</li>
              <li><strong>Global:</strong> X (formerly Twitter) and Revolut are pursuing the model from the social and finance sides.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">Why users love the super app model</h2>
            <p>
              A single app that handles chat, money, food, and rides beats juggling ten specialized
              apps for three reasons:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li><strong>Less friction.</strong> One login, one wallet, no repeated KYC.</li>
              <li><strong>Less storage.</strong> Mini apps live inside the shell; phones stay light.</li>
              <li><strong>Context that follows you.</strong> A chat can become a payment, a payment can trigger a delivery, a delivery can rate a driver — without ever leaving the app.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">Where ONIQ fits</h2>
            <p>
              ONIQ is a super app built for a global, mobile-first audience. It ships the four
              pillars on day one:
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Pillar icon={<MessageCircle className="h-5 w-5" />} title="Chat" body="Real-time messaging with voice and video calls." />
              <Pillar icon={<Wallet className="h-5 w-5" />} title="Wallet" body="A funded demo wallet, send and request money, red packets." />
              <Pillar icon={<QrCode className="h-5 w-5" />} title="Scan & pay" body="UPI-style QR payments, My QR, and merchant intents." />
              <Pillar icon={<Sparkles className="h-5 w-5" />} title="AI + mini apps" body="An AI assistant plus a hub of partner mini apps for rides, food, travel, and live TV." />
            </div>
            <p className="mt-4">
              The same account also unlocks food ordering, rides via Uber and Ola deep links, live
              weather and news, and a Duolingo-style Learn tab with 25-language translation. It is
              the super app model, delivered as one download.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">Are super apps safe?</h2>
            <p>
              A super app concentrates identity and money in one place, so the security bar has to
              be higher than a single-purpose app. ONIQ enforces row-level security on every table,
              routes every money operation through server-side <code>SECURITY DEFINER</code>
              functions with per-call caps, and never stores full bank account numbers — only the
              last four digits are retained after server-side validation.
            </p>
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-border/60 bg-card/50 p-4">
              <ShieldCheck className="mt-1 h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">
                Every transfer is signed server-side. The client never sets the amount that leaves
                your wallet.
              </p>
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">The future of unified digital living</h2>
            <p>
              As phones become the primary computer for billions of people, the super app model
              is spreading beyond its Asian roots. Expect the next generation — ONIQ included — to
              add AI copilots, on-device agents, and cross-border payments to the four classic
              pillars. One app really can cover every world.
            </p>
          </section>

          <section aria-labelledby="faq">
            <h2 id="faq" className="font-display text-2xl font-bold">FAQ</h2>
            <dl className="mt-4 space-y-4">
              <Faq q="What is a super app in simple terms?" a="An app that bundles chat, payments, and everyday services — food, rides, ticketing, mini apps — behind one login and one wallet." />
              <Faq q="Is WhatsApp a super app?" a="Not yet. WhatsApp has added payments and business tools in some markets, but it lacks the mini apps platform and broad service catalog that define a true super app." />
              <Faq q="Is ONIQ free to use?" a="Yes. Sign up with email, get a funded demo wallet, and try chat, payments, food, rides, and mini apps at no cost." />
            </dl>
          </section>

          <div className="mt-10 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 to-transparent p-6">
            <Globe2 className="h-6 w-6 text-primary" />
            <div className="flex-1">
              <p className="font-display text-lg font-bold">Ready to try a super app?</p>
              <p className="text-sm text-muted-foreground">One app. Every world. Get your funded wallet in seconds.</p>
            </div>
            <Link
              to="/auth"
              className="inline-flex items-center gap-1 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Open ONIQ <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}

function Pillar({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-center gap-2 text-primary">{icon}<span className="font-semibold text-foreground">{title}</span></div>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-semibold">{q}</dt>
      <dd className="mt-1 text-muted-foreground">{a}</dd>
    </div>
  );
}
