import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, QrCode, Layers, ShieldCheck, Globe2 } from "lucide-react";

const TITLE = "The Best Super Apps in India: A 2026 Comparison";
const SEO_TITLE = "Best Super Apps in India (2026) | ONIQ";
const DESCRIPTION =
  "Compare India's leading super apps on UPI integration, mini-app ecosystems, and DPDP compliance — Paytm, PhonePe, Tata Neu, Jio, Google Pay, and ONIQ.";
const URL = "https://oniqhub.com/blog/super-apps-in-india";

export const Route = createFileRoute("/blog/super-apps-in-india")({
  head: () => ({
    meta: [
      { title: SEO_TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: SEO_TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SEO_TITLE },
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
          datePublished: "2026-08-03",
          dateModified: "2026-08-03",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://oniqhub.com/" },
            { "@type": "ListItem", position: 2, name: "Blog", item: "https://oniqhub.com/blog/what-is-a-super-app" },
            { "@type": "ListItem", position: 3, name: "Super Apps in India", item: URL },
          ],
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
              name: "Which is the best super app in India?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "There is no single winner. PhonePe and Google Pay lead on UPI volume, Paytm has the widest merchant and mini-app catalog, Tata Neu leads on retail loyalty, and ONIQ combines chat, AI study tools, and UPI intent payments without holding user funds.",
              },
            },
            {
              "@type": "Question",
              name: "What makes an Indian super app different?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Indian super apps are built on UPI rails rather than a closed in-app wallet, so payments move between apps and banks freely. They also operate under the DPDP Act, which requires itemized consent, age gating for minors, and honouring data deletion requests.",
              },
            },
            {
              "@type": "Question",
              name: "Do super apps hold your money?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Some do through prepaid wallets, which require KYC and RBI-licensed issuance. Others, including ONIQ, use UPI intents and QR codes that hand the payment to your own bank or UPI app, so the super app never custodies funds.",
              },
            },
            {
              "@type": "Question",
              name: "Are super apps safe under the DPDP Act?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "A compliant super app must collect itemized consent per purpose, block behavioural tracking for users under 18, publish a grievance officer contact, and let you export or delete your data. Check for these before trusting an app with payments and identity.",
              },
            },
          ],
        }),
      },
    ],
  }),
  component: IndiaSuperAppsGuide,
});

type Row = {
  name: string;
  anchor: string;
  upi: string;
  mini: string;
  note: string;
};

const ROWS: Row[] = [
  {
    name: "PhonePe",
    anchor: "Payments",
    upi: "Native UPI, highest transaction share",
    mini: "Switch mini-app platform (travel, insurance, bills)",
    note: "Strongest UPI reliability; commerce features sit behind the payments tab.",
  },
  {
    name: "Paytm",
    anchor: "Payments + commerce",
    upi: "UPI plus a prepaid wallet (KYC required)",
    mini: "Largest mini-app catalog in India",
    note: "Widest merchant network; the wallet layer adds KYC friction.",
  },
  {
    name: "Google Pay",
    anchor: "Payments",
    upi: "Pure UPI, no wallet custody",
    mini: "Limited — bills, tickets, offers only",
    note: "Cleanest payments UX, deliberately thin as a platform.",
  },
  {
    name: "Tata Neu",
    anchor: "Retail loyalty",
    upi: "UPI plus NeuCoins rewards",
    mini: "In-house brands (BigBasket, Croma, IHCL, Air India)",
    note: "A conglomerate storefront more than an open platform.",
  },
  {
    name: "MyJio",
    anchor: "Telecom",
    upi: "JioPay UPI",
    mini: "JioMart, JioCinema, JioSaavn bundled",
    note: "Huge reach through telecom, weaker outside the Jio ecosystem.",
  },
  {
    name: "ONIQ",
    anchor: "Chat + AI",
    upi: "UPI intents and QR — funds never held by ONIQ",
    mini: "Mini Apps hub, rides, food, live TV, AI study tutor",
    note: "Chat-first shell with an AI tutor and DPDP-native consent controls.",
  },
];

function IndiaSuperAppsGuide() {
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
          <span className="text-foreground">Super Apps in India</span>
        </nav>

        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-primary">
          Comparison · 9 min read
        </p>
        <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">{TITLE}</h1>
        <p className="mt-5 text-lg text-muted-foreground">{DESCRIPTION}</p>

        <div className="prose prose-invert mt-10 max-w-none space-y-8 text-base leading-relaxed">
          <section>
            <h2 className="font-display text-2xl font-bold">Why India built super apps differently</h2>
            <p>
              China's super apps grew around closed wallets: money entered WeChat Pay or Alipay and
              largely stayed there. India took the opposite route. <strong>UPI</strong> made
              real-time bank-to-bank transfer a public utility, so no Indian app needed to own the
              money to own the experience. That single design decision shapes every comparison
              below — the differentiator is not the wallet, it is what surrounds the payment.
            </p>
            <p>
              The second force is regulation. The <strong>DPDP Act</strong> requires itemized
              consent per purpose, restricts behavioural tracking and targeted advertising for users
              under 18, mandates a published grievance officer, and gives users export and deletion
              rights. A 2026 super app that cannot show you those controls is behind.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">The 2026 comparison</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Comparison of Indian super apps by anchor service, UPI integration, and mini-app ecosystem
                </caption>
                <thead>
                  <tr className="border-b border-border/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-3 pr-4 font-semibold">App</th>
                    <th scope="col" className="py-3 pr-4 font-semibold">Anchor</th>
                    <th scope="col" className="py-3 pr-4 font-semibold">UPI integration</th>
                    <th scope="col" className="py-3 font-semibold">Mini apps</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => (
                    <tr key={r.name} className="border-b border-border/40 align-top">
                      <th scope="row" className="py-3 pr-4 font-semibold text-foreground">{r.name}</th>
                      <td className="py-3 pr-4 text-muted-foreground">{r.anchor}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{r.upi}</td>
                      <td className="py-3 text-muted-foreground">{r.mini}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-5 list-disc space-y-2 pl-6">
              {ROWS.map((r) => (
                <li key={r.name}>
                  <strong>{r.name}:</strong> {r.note}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">How to judge a super app</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Pillar
                icon={<QrCode className="h-5 w-5" />}
                title="UPI without custody"
                body="Prefer apps that launch a UPI intent or QR into your own bank app instead of parking a balance they control."
              />
              <Pillar
                icon={<Layers className="h-5 w-5" />}
                title="An open mini-app layer"
                body="A real platform lets third parties ship services inside the shell. A bundle of in-house brands is a storefront, not an ecosystem."
              />
              <Pillar
                icon={<ShieldCheck className="h-5 w-5" />}
                title="DPDP controls you can see"
                body="Itemized consent toggles, an age gate, a grievance officer, and one-tap data export or deletion."
              />
              <Pillar
                icon={<Globe2 className="h-5 w-5" />}
                title="Language coverage"
                body="India is multilingual by default. Check that the interface — not just support content — works in your language."
              />
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold">Where ONIQ fits</h2>
            <p>
              ONIQ is chat-first rather than payments-first. Messaging, calls, Moments, and Reels sit
              at the centre, with an AI study tutor built for CBSE, ICSE, JEE, NEET, and CLAT
              syllabi, plus rides, food, live TV, and a Mini Apps hub around them. Payments run
              through UPI intents and QR codes that open your own UPI app — <strong>ONIQ never holds
              your money</strong>.
            </p>
            <p>
              On compliance, ONIQ ships the DPDP surface as product, not paperwork: an age gate that
              disables tracking for minors, per-purpose consent toggles, a grievance page, and data
              export and deletion with a verifiable deletion proof. The interface itself runs in
              10+ Indian languages.
            </p>
            <p>
              For a broader primer on the category, read{" "}
              <Link to="/blog/what-is-a-super-app" className="text-primary underline">
                what a super app actually is
              </Link>
              .
            </p>
          </section>

          <section aria-labelledby="faq">
            <h2 id="faq" className="font-display text-2xl font-bold">FAQ</h2>
            <dl className="mt-4 space-y-4">
              <Faq
                q="Which is the best super app in India?"
                a="It depends on your anchor need: PhonePe and Google Pay for pure UPI reliability, Paytm for merchant breadth, Tata Neu for retail rewards, and ONIQ if you want chat, an AI tutor, and payments that never leave your own bank app."
              />
              <Faq
                q="Do Indian super apps need KYC?"
                a="Only if they issue a prepaid wallet. Apps that stay on UPI intents rely on your bank's existing KYC, so there is nothing extra to complete."
              />
              <Faq
                q="Is ONIQ free to use?"
                a="Yes. Sign up and use chat, the AI study tutor, UPI tools, rides, food, and mini apps at no cost."
              />
            </dl>
          </section>

          <div className="mt-10 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 to-transparent p-6">
            <Globe2 className="h-6 w-6 text-primary" />
            <div className="flex-1">
              <p className="font-display text-lg font-bold">Try India's chat-first super app</p>
              <p className="text-sm text-muted-foreground">One app. Every world. Set up in seconds.</p>
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
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="font-semibold text-foreground">{title}</span>
      </div>
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
