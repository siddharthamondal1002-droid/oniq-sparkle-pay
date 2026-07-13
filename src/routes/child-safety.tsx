import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/child-safety")({
  head: () => ({
    meta: [
      { title: "Child Safety Standards — ONIQ" },
      {
        name: "description",
        content:
          "ONIQ's zero-tolerance standards against child sexual abuse and exploitation (CSAE), reporting channels, and legal compliance under POCSO and IT Rules 2021.",
      },
      { property: "og:title", content: "Child Safety Standards — ONIQ" },
      {
        property: "og:description",
        content:
          "ONIQ has zero tolerance for CSAE. Learn how we prevent, detect, and report child sexual abuse material.",
      },
    ],
  }),
  component: ChildSafetyPage,
});

function ChildSafetyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-14">
        <Link to="/" className="text-sm text-primary hover:underline">
          ← Back to ONIQ
        </Link>
        <h1 className="mt-4 font-display text-4xl font-bold">Child Safety Standards</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          App: <strong>Oniq — The supapp</strong> by ONIQ (oniqhub.com). Last updated:{" "}
          {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
        </p>

        <section className="prose prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">
          <h2 className="mt-8 font-display text-2xl font-semibold">1. Zero tolerance for CSAE</h2>
          <p>
            ONIQ has <strong>zero tolerance</strong> for child sexual abuse and exploitation
            (CSAE). Our published standards are:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              ONIQ is intended for users <strong>18 years of age and older</strong>, as stated in
              our Terms of Service.
            </li>
            <li>
              We prohibit any content or behavior that sexualizes, exploits, or endangers minors —
              including child sexual abuse material (CSAM), grooming, sextortion, and trafficking.
            </li>
            <li>
              Accounts that violate these standards are removed. Related devices and identifiers
              may be blocked from re-registering.
            </li>
          </ul>

          <h2 className="font-display text-2xl font-semibold">2. In-app reporting</h2>
          <p>
            Every user can report content, messages, accounts, moments, and clips directly inside
            the app. Tap the <strong>Report</strong> action on the item, choose a reason, and
            optionally add details. Reports involving potential child safety concerns are{" "}
            <strong>prioritized for immediate review</strong> by our team.
          </p>

          <h2 className="font-display text-2xl font-semibold">3. Action on confirmed CSAM</h2>
          <p>Confirmed child sexual abuse material is:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Removed from ONIQ immediately.</li>
            <li>
              Reported to the <strong>National Center for Missing &amp; Exploited Children
              (NCMEC)</strong> CyberTipline.
            </li>
            <li>
              Reported to Indian law enforcement and the{" "}
              <a
                className="text-primary hover:underline"
                href="https://cybercrime.gov.in"
                target="_blank"
                rel="noreferrer"
              >
                National Cyber Crime Reporting Portal (cybercrime.gov.in)
              </a>
              , as required by law — including the Protection of Children from Sexual Offences
              (POCSO) Act, 2012 and India's Information Technology (Intermediary Guidelines and
              Digital Media Ethics Code) Rules, 2021.
            </li>
            <li>Preserved securely for the period required by law to support investigations.</li>
          </ul>

          <h2 className="font-display text-2xl font-semibold">4. Designated point of contact</h2>
          <div className="rounded-2xl border border-border bg-card p-5 text-sm">
            <div className="font-semibold">Child Safety &amp; Grievance Officer</div>
            <div>Siddhartha Mondal</div>
            <div>
              Email:{" "}
              <a
                className="text-primary hover:underline"
                href="mailto:grievance@oniqhub.com?subject=Child%20Safety%20Concern"
              >
                grievance@oniqhub.com
              </a>
            </div>
            <p className="mt-2 text-muted-foreground">
              This contact can speak to ONIQ's CSAE prevention practices and compliance
              obligations, and is designated under India's IT Rules 2021.
            </p>
          </div>

          <p className="mt-10 border-t border-border pt-6 text-sm">
            See also our{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link to="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
