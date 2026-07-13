import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: "Delete your ONIQ account — ONIQ" },
      {
        name: "description",
        content:
          "How to delete your ONIQ account and associated data — in-app or by email to our Grievance Officer.",
      },
      { property: "og:title", content: "Delete your ONIQ account — ONIQ" },
      {
        property: "og:description",
        content: "Two ways to delete your ONIQ account and what data is removed.",
      },
    ],
  }),
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-14">
        <Link to="/" className="text-sm text-primary hover:underline">
          ← Back to ONIQ
        </Link>
        <h1 className="mt-4 font-display text-4xl font-bold">Delete your ONIQ account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          App: <strong>Oniq — The supapp</strong> by ONIQ (oniqhub.com). Last updated:{" "}
          {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
        </p>

        <section className="prose prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">
          <p>
            You can delete your ONIQ account at any time. There are two ways to do it — pick
            whichever is easiest.
          </p>

          <h2 className="mt-8 font-display text-2xl font-semibold">Option A — In the app</h2>
          <div className="rounded-2xl border border-border bg-card p-5">
            <ol className="list-decimal space-y-2 pl-6">
              <li>Open ONIQ and sign in.</li>
              <li>
                Go to the <strong>Profile</strong> tab (bottom-right of the home screen).
              </li>
              <li>
                Scroll to <strong>Delete my account</strong> and tap it.
              </li>
              <li>
                Type <code className="rounded bg-muted px-1.5 py-0.5">DELETE</code> to confirm, then
                tap <strong>Delete forever</strong>.
              </li>
            </ol>
            <p className="mt-3 text-sm text-muted-foreground">
              Your account is removed immediately and you're signed out.
            </p>
          </div>

          <h2 className="font-display text-2xl font-semibold">Option B — By email</h2>
          <p>Don't have the app installed anymore? Email our Grievance Officer:</p>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div>
              <strong>To:</strong>{" "}
              <a className="text-primary hover:underline" href="mailto:grievance@oniqhub.com?subject=Delete%20my%20ONIQ%20account">
                grievance@oniqhub.com
              </a>
            </div>
            <div>
              <strong>Subject:</strong> Delete my ONIQ account
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              Send from the email address (or include the phone number) registered on your ONIQ
              account so we can verify ownership. We process verified requests within{" "}
              <strong>7 days</strong>.
            </div>
          </div>

          <h2 className="font-display text-2xl font-semibold">What gets deleted</h2>
          <p>When your account is deleted, the following are removed:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Your profile (name, username, avatar, bio)</li>
            <li>Your authentication record (you can no longer sign in)</li>
            <li>
              Content owned by your account and cascaded from your profile — messages you sent,
              media you uploaded, moments, clips, statuses, call log entries, contact matches,
              wallet records, and device push tokens
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Messages you sent inside group chats may remain visible to other participants as part of
            their own chat history, but are no longer attributable to an active account.
          </p>

          <h2 className="font-display text-2xl font-semibold">What we keep (and for how long)</h2>
          <p>
            We keep a minimal set of records for up to <strong>90 days</strong> only where required
            for legal compliance — primarily grievance and safety-report records under India's
            Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules,
            2021, and basic transaction logs required by law. After 90 days these are purged.
          </p>

          <h2 className="font-display text-2xl font-semibold">Questions</h2>
          <p>
            Contact our Grievance Officer, Siddhartha Mondal, at{" "}
            <a className="text-primary hover:underline" href="mailto:grievance@oniqhub.com">
              grievance@oniqhub.com
            </a>
            .
          </p>

          <p className="mt-10 border-t border-border pt-6 text-sm">
            See also our{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
