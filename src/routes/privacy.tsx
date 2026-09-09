import { createFileRoute, Link } from "@tanstack/react-router";
import { GRIEVANCE_OFFICER } from "@/config/privacy";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — ONIQ" },
      {
        name: "description",
        content:
          "How ONIQ collects, uses, and protects your data. DPDP-aligned plain-language policy.",
      },
      { property: "og:title", content: "Privacy Policy — ONIQ" },
      {
        property: "og:description",
        content: "What we collect, why we collect it, and the controls you have.",
      },
      { property: "og:url", content: "https://oniqhub.com/privacy" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://oniqhub.com/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-14">
        <Link to="/" className="text-sm text-primary hover:underline">
          ← Back to ONIQ
        </Link>
        <h1 className="mt-4 font-display text-4xl font-bold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated:{" "}
          {new Date().toLocaleDateString("en-IN", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>

        <section className="prose prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">
          <p>
            ONIQ is a lifestyle super app. This policy explains what we collect, why, and the
            controls you have. It is aligned with India's Digital Personal Data Protection Act, 2023
            (DPDP).
          </p>

          <h2 className="mt-8 font-display text-2xl font-semibold">1. What we collect</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Account info</strong> — email, username, display name, avatar (if provided).
            </li>
            <li>
              <strong>Messages and calls</strong> — chat content and media stored to deliver them.
              Data is encrypted at rest by our infrastructure provider and in transit via TLS. Voice
              and video call audio/video streams are peer-to-peer where possible and are not
              recorded by us.
            </li>
            <li>
              <strong>Uploads</strong> — clips, moments, avatars, wallpapers you upload.
            </li>
            <li>
              <strong>Basic telemetry</strong> — error and performance logs to keep the service
              running. No third-party ad trackers.
            </li>
            <li>
              <strong>Location, only when you ask for it</strong> — if you tap to use your current
              location for a ride, delivery or nearby lookup, we read your precise coordinates at
              that moment to resolve the place. We do not track you in the background and we do not
              store your coordinates. Separately, we read a country-level signal from the network
              edge to show country-correct content; it is used and discarded, never stored.
            </li>
            <li>
              <strong>Contacts, only when you ask for it</strong> — if you choose to find friends
              already on ONIQ, we read phone numbers from your address book to match them against
              existing accounts. We do not upload your address book wholesale or keep a copy of your
              contact graph.
            </li>
            <li>
              <strong>What you type into our AI features</strong> — see section 4.
            </li>
          </ul>

          <h2 className="font-display text-2xl font-semibold">2. Why we use it</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>Provide messaging, calls, clips, and other in-app features you request.</li>
            <li>
              Keep the service safe: detect abuse, respond to reports, honour lawful takedown
              orders.
            </li>
            <li>Comply with applicable law.</li>
          </ul>
          <p>
            We do <strong>not</strong> sell your personal data. We do <strong>not</strong> show
            third-party ads.
          </p>

          <h2 className="font-display text-2xl font-semibold">3. Health & Wellness Data</h2>
          <p>
            ONIQ's <strong>Vitals</strong> hub is optional. If you choose to use it, we store:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Menstrual cycle logs</strong> — period start/end dates, symptoms you tag, and
              any notes you add.
            </li>
            <li>
              <strong>Daily wellness check-ins</strong> — sleep hours, mood, energy, whether you
              exercised, and water intake.
            </li>
          </ul>
          <p>
            This data is stored securely in our database and protected by row-level security, so it
            is accessible only to the account that created it. Health data is <strong>never</strong>{" "}
            used for advertising, <strong>never</strong> shared with or sold to third parties, and
            is <strong>not</strong> used for analytics or user profiling.
          </p>
          <p>
            You can delete individual cycle logs and check-ins from inside the Vitals hub at any
            time, use "Delete all my health data" to wipe every health record in one action, or
            delete your entire ONIQ account — which permanently removes all health data along with
            the rest of your profile. For any health-data request, contact{" "}
            <a className="text-primary hover:underline" href={`mailto:${GRIEVANCE_OFFICER.email}`}>
              {GRIEVANCE_OFFICER.email}
            </a>
            .
          </p>

          <h2 className="font-display text-2xl font-semibold">
            4. AI features and the provider behind them
          </h2>
          <p>
            Three parts of ONIQ generate text: <strong>Ting</strong>, the{" "}
            <strong>Study Buddy</strong> tutor and paper generator, and the{" "}
            <strong>CV builder</strong>. They do not run on our own servers.
          </p>
          <p>
            When you use them, what you type is sent to <strong>Anthropic</strong>, which operates
            the model that produces the response. For the CV builder that includes the facts you
            enter about yourself — your qualifications, employers and dates — because those are what
            the CV is written from.
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Your input is used to produce your answer, and for nothing else. It is{" "}
              <strong>not</strong> used to train a model, <strong>not</strong> used for advertising,
              and <strong>not</strong> sold.
            </li>
            <li>
              <strong>
                Health data may be processed by ONIQ's AI-assisted health features when you choose
                to use them and provide the required consent.
              </strong>{" "}
              AI-assisted features are subject to ONIQ's privacy, security, consent, audit, and
              safety controls. When you use them, the records you ask about, and any report you ask
              them to read (its text, or the photo or PDF itself), are sent to{" "}
              <strong>Google Cloud Vertex AI (Gemini)</strong>, operated by Google, to produce the
              answer, and are not used to train Google's models.
            </li>
            <li>
              Generated output is labelled as AI-generated, and you can report a bad answer from
              inside the app.
            </li>
            <li>
              If you would rather nothing was sent, do not use these three features — the rest of
              ONIQ works without them.
            </li>
          </ul>

          <h2 className="font-display text-2xl font-semibold">5. Your rights</h2>

          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Access & correction</strong> — view and edit your profile fields from Profile.
            </li>
            <li>
              <strong>Erasure</strong> — delete your account from Profile → Delete account. This
              removes your profile, messages you sent, and uploads.
            </li>
            <li>
              <strong>Grievance redressal</strong> — contact our Grievance Officer (below) for
              privacy complaints.
            </li>
          </ul>

          <h2 className="font-display text-2xl font-semibold">6. Children</h2>
          <p>
            ONIQ is intended for users 18 years and above. We do not knowingly collect personal data
            from children.
          </p>

          <h2 className="font-display text-2xl font-semibold">7. Breach notification</h2>
          <p>
            If we become aware of a personal-data breach that is likely to result in risk to your
            rights, we will notify affected users and the Data Protection Board of India within the
            timelines required by DPDP.
          </p>

          <h2 className="font-display text-2xl font-semibold">8. Data retention and deletion</h2>
          <p>
            We keep personal data only for as long as it is needed for the purpose it was collected
            for, and no longer. Each category has its own period:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Account data</strong> (email, user name, display name, avatar) — kept for as
              long as your account is open. It is erased when you delete the account.
            </li>
            <li>
              <strong>Messages, calls and uploads</strong> (chat content, clips, moments, avatars,
              wallpapers) — kept while your account is open, or until you delete the individual
              item, whichever comes first. Voice and video call streams are peer-to-peer where
              possible and are never recorded or stored by us.
            </li>
            <li>
              <strong>Status updates</strong> — deleted automatically 24 hours after posting.
            </li>
            <li>
              <strong>One-time passcodes</strong> — expire and are discarded 10 minutes after they
              are issued.
            </li>
            <li>
              <strong>Parental-consent requests</strong> — expire 7 days after they are raised.
            </li>
            <li>
              <strong>Health and wellness data</strong> (Vitals hub) — kept only while you use the
              hub. You can delete individual cycle logs and check-ins at any time, and deleting your
              account removes all of it.
            </li>
            <li>
              <strong>Location</strong> — read only at the moment you ask for it and discarded
              immediately. We do not track you in the background and we do not store coordinates.
            </li>
            <li>
              <strong>Contacts</strong> — phone numbers are matched against existing accounts and
              discarded. We do not upload your address book or keep a copy of your contact graph.
            </li>
            <li>
              <strong>Diagnostic and performance logs</strong> — kept for up to 90 days, then
              deleted.
            </li>
            <li>
              <strong>Safety, abuse and copyright records</strong> — kept for up to 180 days after
              the report is actioned, so that repeat abuse can be identified and appeals can be
              answered, then deleted.
            </li>
            <li>
              <strong>Records we are legally required to keep</strong> (tax and payment records,
              data under a legal hold or a lawful order) — kept for the period the law requires, and
              deleted once it ends. A legal hold is released as soon as the matter closes.
            </li>
          </ul>
          <p>
            <strong>When you delete your account</strong>, it enters a 30-day grace period during
            which you can change your mind by signing back in. If you do not, the account is
            permanently purged: your stored media is removed from our storage buckets and every
            related record is deleted from our database. Nothing personal survives the purge except
            the legally required records listed above.
          </p>
          <p>
            Backups are kept for disaster recovery and roll off on their own cycle; deleted data is
            not restored from a backup into a live account.
          </p>

          <h2 className="font-display text-2xl font-semibold">9. Contact</h2>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="font-semibold">Grievance Officer</div>
            <div>{GRIEVANCE_OFFICER.name}</div>
            <div>
              Email:{" "}
              <a
                className="text-primary hover:underline"
                href={`mailto:${GRIEVANCE_OFFICER.email}`}
              >
                {GRIEVANCE_OFFICER.email}
              </a>
            </div>
          </div>

          <p className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
            This document is a template maintained by a small intermediary and is not legal advice.
          </p>

          <p className="text-sm">
            See also our{" "}
            <Link to="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>
            ,{" "}
            <Link to="/delete-account" className="text-primary hover:underline">
              Delete your account
            </Link>
            , and{" "}
            <Link to="/child-safety" className="text-primary hover:underline">
              Child Safety Standards
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
