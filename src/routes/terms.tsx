import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — ONIQ" },
      { name: "description", content: "ONIQ Terms of Service — user conduct, prohibited content, account termination, and India IT Rules 2021 grievance mechanism." },
      { property: "og:title", content: "Terms of Service — ONIQ" },
      { property: "og:description", content: "Rules, prohibited content, grievance officer, and content-takedown timelines." },
      { property: "og:url", content: "https://oniqhub.com/terms" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://oniqhub.com/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-14">
        <Link to="/" className="text-sm text-primary hover:underline">← Back to ONIQ</Link>
        <h1 className="mt-4 font-display text-4xl font-bold">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>

        <section className="prose prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">
          <p>Welcome to ONIQ ("we", "us", "the app"). By creating an account or using ONIQ you agree to these Terms. They are written in plain language on purpose.</p>

          <h2 className="mt-8 font-display text-2xl font-semibold">1. Who can use ONIQ</h2>
          <p>ONIQ is for people aged 18 and above. You must provide accurate information and keep your login credentials safe. You are responsible for activity on your account.</p>

          <h2 className="font-display text-2xl font-semibold">2. Prohibited content and conduct</h2>
          <p>You agree not to host, display, upload, publish, share, transmit or otherwise make available on ONIQ any information that:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Belongs to another person and to which you have no right;</li>
            <li>Is obscene, pornographic, paedophilic, invasive of another's privacy (including bodily privacy), insulting or harassing on the basis of gender, libellous, racially or ethnically objectionable, or otherwise inconsistent with or contrary to Indian law;</li>
            <li>Is harmful to a child in any way;</li>
            <li>Infringes any patent, trademark, copyright or other proprietary rights;</li>
            <li>Violates any law for the time being in force;</li>
            <li>Deceives or misleads the addressee about the origin of the message, or knowingly and intentionally communicates any misinformation or information which is patently false and untrue or misleading in nature;</li>
            <li>Impersonates another person;</li>
            <li>Threatens the unity, integrity, defence, security or sovereignty of India, friendly relations with foreign states, or public order, or causes incitement to the commission of any cognisable offence, or prevents investigation of any offence, or is insulting other nation;</li>
            <li>Contains software viruses or any other computer code, file or program designed to interrupt, destroy or limit the functionality of any computer resource;</li>
            <li>Is <strong>synthetically generated information</strong> (audio, video, image or text produced or modified by AI, including "deepfakes") used unlawfully or in a manner that misleads, defrauds, or harms another person. Under the 2026 IT Rules Amendment, synthetically generated information shared on ONIQ must not be used to impersonate, defame, or spread misinformation.</li>
          </ul>

          <h2 className="font-display text-2xl font-semibold">3. Account termination</h2>
          <p>We may suspend or terminate your account, remove content, and cooperate with lawful authorities if you violate these Terms or applicable law. You may delete your account at any time from Profile → Delete account.</p>

          <h2 className="font-display text-2xl font-semibold">4. Grievance mechanism (IT Rules, 2021)</h2>
          <p>We have designated a Grievance Officer as required under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.</p>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="font-semibold">Grievance Officer</div>
            <div>Siddhartha Mondal</div>
            <div>Email: <a className="text-primary hover:underline" href="mailto:grievance@oniqhub.com">grievance@oniqhub.com</a></div>
          </div>
          <p><strong>Timelines we commit to:</strong></p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Complaints acknowledged within <strong>24 hours</strong> and resolved within <strong>15 days</strong>.</li>
            <li>Serious complaints (impersonation, identity theft, non-consensual intimate imagery) resolved within <strong>36 hours</strong> of a valid complaint.</li>
            <li>Content removal within <strong>3 hours</strong> of receipt of a lawful government or court order, and within <strong>2 hours</strong> for reported non-consensual intimate imagery.</li>
          </ul>

          <h2 className="font-display text-2xl font-semibold">5. Reporting content in the app</h2>
          <p>Every message, user, and clip in ONIQ can be reported using the flag icon or long-press menu. Reports include the reason, optional details, and are routed to our moderation queue for review.</p>

          <h2 className="font-display text-2xl font-semibold">6. Disclaimer</h2>
          <p>ONIQ is a communications platform provided "as is". We are not liable for user-generated content beyond what applicable law requires of an intermediary acting in good faith.</p>

          <p className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
            This document is a template maintained by a small intermediary to comply with the IT Rules, 2021 and its 2026 Amendment. It is not legal advice. Consult a lawyer for jurisdiction-specific obligations.
          </p>

          <p className="text-sm">
            See also our <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}
