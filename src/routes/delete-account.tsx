import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GRIEVANCE_OFFICER } from "@/config/privacy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: "Delete your ONIQ account — ONIQ" },
      {
        name: "description",
        content:
          "How to permanently delete your ONIQ account and personal data — self-service in-app or by email to our Grievance Officer.",
      },
      { property: "og:title", content: "Delete your ONIQ account — ONIQ" },
      {
        property: "og:description",
        content: "Two ways to permanently delete your ONIQ account and data.",
      },
    ],
  }),
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [confirm1, setConfirm1] = useState(false);
  const [confirm2, setConfirm2] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setEmail(s?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function runDelete() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("delete_my_account" as never);
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Your ONIQ account has been permanently deleted.");
      setConfirm1(false);
      setConfirm2(false);
      setTyped("");
      setTimeout(() => navigate({ to: "/" }), 800);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-14">
        <Link to="/" className="text-sm text-primary hover:underline">
          ← Back to ONIQ
        </Link>
        <h1 className="mt-4 font-display text-4xl font-bold">Delete your ONIQ account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          App: <strong>ONIQ</strong> by ONIQ (oniqhub.com). Last updated:{" "}
          {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
        </p>

        <section className="prose prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">
          <p>
            You can permanently delete your ONIQ account and all associated personal data at any
            time. Choose one of the two methods below.
          </p>

          <h2 className="mt-8 font-display text-2xl font-semibold">
            Method A — Delete on this page (recommended)
          </h2>
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            {!email ? (
              <>
                <p className="text-sm">
                  Sign in first to permanently delete your account from this page.
                </p>
                <Button asChild>
                  <Link to="/auth">Sign in to delete my account</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm">
                  Signed in as <strong>{email}</strong>. Deleting is permanent and cannot be undone.
                </p>
                <Button
                  variant="destructive"
                  onClick={() => setConfirm1(true)}
                  disabled={busy}
                  data-testid="delete-account-start"
                >
                  Delete my account permanently
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => supabase.auth.signOut()}
                  className="ml-2"
                >
                  Sign out
                </Button>
              </>
            )}
          </div>

          <h2 className="font-display text-2xl font-semibold">Method B — Email request</h2>
          <p>If you can't sign in, email our Grievance Officer:</p>
          <div className="rounded-2xl border border-border bg-card p-5 text-sm">
            <div>
              <strong>To:</strong>{" "}
              <a
                className="text-primary hover:underline"
                href={`mailto:${GRIEVANCE_OFFICER.email}?subject=Account%20Deletion%20Request`}
              >
                {GRIEVANCE_OFFICER.email}
              </a>
            </div>
            <div>
              <strong>Subject:</strong> Account Deletion Request
            </div>
            <p className="mt-2 text-muted-foreground">
              Send from the email address registered on your ONIQ account so we can verify
              ownership. Verified requests are processed within <strong>7 days</strong>.
            </p>
          </div>

          <h2 className="font-display text-2xl font-semibold">
            Delete some of your data (without deleting your account)
          </h2>
          <p>
            You do not need to delete your ONIQ account to remove specific data. Inside the app you
            can:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Delete individual messages you sent (delete for everyone) in any chat.</li>
            <li>Delete your Moments posts and Clips at any time.</li>
            <li>
              Delete individual health records — cycle logs and daily check-ins — in the Vitals
              hub, or use "Delete all my health data" to wipe every health record in one action.
            </li>
          </ul>
          <p>
            For any other partial data deletion request (for example, specific records you cannot
            remove in-app), email{" "}
            <a
              className="text-primary hover:underline"
              href={`mailto:${GRIEVANCE_OFFICER.email}?subject=Data%20Deletion%20Request`}
            >
              {GRIEVANCE_OFFICER.email}
            </a>{" "}
            with subject "Data Deletion Request" from your registered email, describing what you
            want removed. Verified requests are processed within <strong>7 days</strong>.
          </p>

          <h2 className="font-display text-2xl font-semibold">What is permanently deleted</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>Your profile (name, username, avatar, bio) and sign-in account</li>
            <li>Messages you sent, message reactions, and chat memberships</li>
            <li>Moments posts, likes, and comments</li>
            <li>Clips you uploaded, along with their likes, views, and comments</li>
            <li>Status updates and status views</li>
            <li>Health & wellness data — cycle logs, daily check-ins, health profile</li>
            <li>Call log entries where you were the caller</li>
            <li>Food orders and any archived account records</li>
            <li>Social graph — friendships, follows, blocks, channel subscriptions</li>
            <li>Learn progress and stats, AI chat history, device push tokens, theme settings</li>
            <li>Reports you filed</li>
          </ul>

          <h2 className="font-display text-2xl font-semibold">What may be retained</h2>
          <p>
            A minimal set of records may be retained where required by law — primarily
            grievance/safety-report correspondence under India's
            Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules,
            2021. These are retained for up to <strong>90 days</strong> and then purged. Messages
            you sent inside group chats remain visible to other participants as part of their own
            chat history, but are marked as coming from a deleted account.
          </p>

          <h2 className="font-display text-2xl font-semibold">Questions</h2>
          <p>
            Contact our Grievance Officer, {GRIEVANCE_OFFICER.name}, at{" "}
            <a className="text-primary hover:underline" href={`mailto:${GRIEVANCE_OFFICER.email}`}>
              {GRIEVANCE_OFFICER.email}
            </a>{" "}
            or{" "}
            <a className="text-primary hover:underline" href={`tel:${GRIEVANCE_OFFICER.phone}`}>
              {GRIEVANCE_OFFICER.phoneDisplay}
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

      {/* First confirm */}
      <AlertDialog open={confirm1} onOpenChange={setConfirm1}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete your ONIQ account?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes your profile, messages, moments, clips, health data, call logs,
              and all other personal data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConfirm1(false);
                setConfirm2(true);
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Second confirm — type DELETE */}
      <AlertDialog open={confirm2} onOpenChange={setConfirm2}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Final confirmation</AlertDialogTitle>
            <AlertDialogDescription>
              Type <code className="rounded bg-muted px-1.5 py-0.5">DELETE</code> below to
              permanently erase your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setTyped("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={typed !== "DELETE" || busy}
              onClick={(e) => {
                e.preventDefault();
                if (typed === "DELETE") runDelete();
              }}
            >
              {busy ? "Deleting…" : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
