import { createFileRoute, Link } from "@tanstack/react-router";
import { GRIEVANCE_OFFICER } from "@/config/privacy";
import {
  DMCA_AGENT,
  DMCA_PROTECTION,
  IN_INTERMEDIARY,
  REPEAT_INFRINGER,
  SERVICE_PROVIDER,
} from "@/config/copyright";

export const Route = createFileRoute("/dmca")({
  head: () => ({
    meta: [
      { title: "Copyright & Takedown — ONIQ" },
      {
        name: "description",
        content:
          "How to report copyright infringement on ONIQ: DMCA notice-and-takedown, counter-notice, repeat-infringer policy, India IT Rules takedown and 180-day retention.",
      },
      { property: "og:title", content: "Copyright & Takedown — ONIQ" },
      { property: "og:url", content: "https://oniqhub.com/dmca" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://oniqhub.com/dmca" }],
  }),
  component: DmcaPage,
});

function DmcaPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-14">
        <Link to="/" className="text-sm text-primary hover:underline">
          ← Back to ONIQ
        </Link>
        <h1 className="mt-4 font-display text-4xl font-bold">Copyright &amp; Takedown</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated:{" "}
          {new Date().toLocaleDateString("en-IN", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>

        <section className="prose prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">
          <h2 className="mt-8 font-display text-2xl font-semibold">What ONIQ is</h2>
          <p>
            ONIQ is an information-location tool. Where we show news, channel listings or app
            listings we store a <strong>pointer</strong> — a headline, a channel name, a link — and
            send you to the publisher, broadcaster or app that owns the material. We do not copy,
            re-host, mirror, proxy or restream anyone&rsquo;s content, and we do not store article
            bodies.
          </p>
          <p>
            ONIQ does not stream or embed live TV or radio in any country. Watch and the faith
            channel lists are directories: every entry opens the channel or station on its own
            platform, where that platform applies its own regional availability and age rules.
            Nothing plays inside ONIQ.
          </p>
          <p>
            If you believe something we link to infringes your copyright, tell us and we will act.
            We would also rather hear about a bad link than leave it up: if a destination is
            unlawful, we want it out of the app.
          </p>

          <h2 className="font-display text-2xl font-semibold">Sending a copyright notice</h2>
          <p>
            Email <a href={`mailto:${DMCA_AGENT.email}`}>{DMCA_AGENT.email}</a> with all of the
            following. A notice missing any of these may not be actionable:
          </p>
          <ul className="list-disc space-y-1 ps-6">
            <li>Your physical or electronic signature.</li>
            <li>Identification of the copyrighted work you say has been infringed.</li>
            <li>
              The exact location in ONIQ of the material you are complaining about — enough detail
              for us to find it.
            </li>
            <li>Your address, telephone number and email address.</li>
            <li>
              A statement that you have a good-faith belief the use is not authorised by the
              copyright owner, its agent, or the law.
            </li>
            <li>
              A statement, <strong>made under penalty of perjury</strong>, that the information in
              your notice is accurate and that you are the copyright owner or authorised to act for
              them.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Knowingly making a material misrepresentation in a takedown notice carries liability for
            damages under 17 U.S.C. §512(f). Please do not send one lightly.
          </p>

          <h2 className="font-display text-2xl font-semibold">What we do when we receive one</h2>
          <ul className="list-disc space-y-1 ps-6">
            <li>We acknowledge receipt.</li>
            <li>
              If the notice is complete and substantiated, we remove or disable the link
              expeditiously.
            </li>
            <li>
              Where the material came from an ONIQ user, we notify them and tell them how to send a
              counter-notice.
            </li>
            <li>
              We keep a record of the notice and of what we removed for{" "}
              <strong>{IN_INTERMEDIARY.takedownRetentionDays} days</strong>, then delete it
              automatically.
            </li>
          </ul>

          <h2 className="font-display text-2xl font-semibold">Counter-notice</h2>
          <p>
            If your material was removed and you believe that was a mistake or a
            misidentification, email {DMCA_AGENT.email} with your signature, identification of the
            removed material and where it appeared, and a statement under penalty of perjury that
            you have a good-faith belief it was removed in error. Include your name, address and
            phone number, and a statement that you consent to the jurisdiction of the federal
            district court for your district (or, if outside the US, any district in which ONIQ may
            be found), and that you will accept service of process from the complainant.
          </p>

          <h2 className="font-display text-2xl font-semibold">Repeat infringers</h2>
          <p>
            We terminate the accounts of repeat infringers. In practice: a substantiated,
            un-retracted notice against your account is a strike, and{" "}
            <strong>{REPEAT_INFRINGER.strikesBeforeTermination} strikes</strong> within{" "}
            {REPEAT_INFRINGER.strikeWindowDays} days ends the account. Strikes are counted from the
            takedown record itself, not tracked by hand, and a notice that is withdrawn or
            successfully countered does not count.
          </p>

          <h2 className="font-display text-2xl font-semibold">Designated agent (United States)</h2>
          {DMCA_AGENT.registeredWithCopyrightOffice ? (
            <p>
              ONIQ has designated an agent with the U.S. Copyright Office to receive notifications
              of claimed infringement, as required by 17 U.S.C. §512(c)(2). Registered{" "}
              {DMCA_AGENT.registrationDate}; renewal due {DMCA_AGENT.renewalDueDate}. The
              designation is listed in the{" "}
              <a href={DMCA_AGENT.directoryUrl} rel="noopener noreferrer" target="_blank">
                Copyright Office directory
              </a>
              .
            </p>
          ) : (
            <p>
              ONIQ has <strong>not yet</strong> designated an agent with the U.S. Copyright Office.
              We are saying so plainly rather than implying a protection we do not have: until that
              registration is made, ONIQ does not claim the §512 safe harbour in the United States.
              The process above applies regardless, and notices sent to {DMCA_AGENT.email} are
              acted on the same way.
            </p>
          )}

          {DMCA_PROTECTION.vendorProtection && (
            <>
              <h2 className="font-display text-2xl font-semibold">
                About the {DMCA_PROTECTION.vendor} badge
              </h2>
              <p>
                ONIQ subscribes to {DMCA_PROTECTION.vendor} {DMCA_PROTECTION.plan}, and its badge
                appears in the footer of our site. It is worth being exact about what that is,
                because badges of this kind are widely misread.
              </p>
              <p>
                What it is: a commercial monitoring and takedown-assistance service. It watches for
                copies of <em>ONIQ&rsquo;s own</em> pages appearing elsewhere and helps us get them
                removed. In that arrangement ONIQ is the rights-holder asking for protection. The
                badge also links to a{" "}
                <a href={DMCA_PROTECTION.statusUrl} rel="noopener noreferrer" target="_blank">
                  public status page
                </a>{" "}
                confirming the subscription is current.
              </p>
              <p>
                What it is <strong>not</strong>: a designation under 17 U.S.C. §512(c)(2), and not
                safe harbour. Those run in the opposite direction — they concern ONIQ&rsquo;s
                liability for material our users link to — and they come only from the U.S.
                Copyright Office register. No private company can grant them. The section above
                states ONIQ&rsquo;s actual position, and the badge does not change it.
              </p>
            </>
          )}

          <h2 className="font-display text-2xl font-semibold">India — IT Act and IT Rules 2021</h2>
          <p>
            For complaints under Indian law, contact our Grievance Officer,{" "}
            {GRIEVANCE_OFFICER.name} ({GRIEVANCE_OFFICER.role}), at{" "}
            <a href={`mailto:${GRIEVANCE_OFFICER.email}`}>{GRIEVANCE_OFFICER.email}</a>. We
            acknowledge every complaint within{" "}
            <strong>{IN_INTERMEDIARY.acknowledgeWithinHours} hours</strong> and dispose of it within{" "}
            <strong>{IN_INTERMEDIARY.resolveWithinDays} days</strong>. We act on orders of a court
            or an authorised government agency, and retain removed material and its records for{" "}
            {IN_INTERMEDIARY.takedownRetentionDays} days.
          </p>

          <h2 className="font-display text-2xl font-semibold">
            United Kingdom and the European Union
          </h2>
          <p>
            We do not monitor content proactively and have no general obligation to do so. We act
            expeditiously on actual knowledge of unlawful material. Service provider:{" "}
            {SERVICE_PROVIDER.serviceName}, {SERVICE_PROVIDER.site}, contact{" "}
            <a href={`mailto:${SERVICE_PROVIDER.contactEmail}`}>
              {SERVICE_PROVIDER.contactEmail}
            </a>
            .
          </p>

          <h2 className="font-display text-2xl font-semibold">Trade marks and names</h2>
          <p>
            Publisher, broadcaster, exchange, board and app names in ONIQ are used descriptively to
            tell you where a link goes. We display no third-party logos. ONIQ is not affiliated
            with, endorsed by, or sponsored by any of them.
          </p>

          <p className="text-sm text-muted-foreground">
            See also our <Link to="/terms">Terms of Service</Link> and{" "}
            <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}
