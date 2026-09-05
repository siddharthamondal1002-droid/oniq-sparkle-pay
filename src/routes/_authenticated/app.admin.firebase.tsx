// ADMIN-ONLY tool: what actually exists in the Firebase project.
// Deliberately unstyled, like the GPU tool beside it.
//
// WHY A SCREEN EXISTS FOR THIS AT ALL. Owner directive 2026-09-05 moves
// identity, chat and files onto Firebase, and two facts gate the whole plan —
// whether a WEB APP is registered, and whether FIRESTORE is provisioned.
// Neither can be answered from outside: measured 2026-09-05, the
// unauthenticated Firestore endpoint returns Google's generic HTML 404 for a
// project that certainly does not exist just as readily as for oniq-309bd,
// and an unauthenticated read of the real Storage bucket 404s too even though
// google-services.json proves that bucket is the project's own. A probe that
// answers identically for "absent" and "not allowed to look" is not evidence.
//
// The only credential that CAN answer is FIREBASE_SERVICE_ACCOUNT, which is
// readable in an edge function and nowhere else ONIQ controls — not the dev
// container, not CI, not the Lovable sandbox. And the function is admin-gated,
// so the only account that may call it is the one admin this project has.
// Hence a button: it is the shortest path from "blocked" to "answered".
//
// THE SCREEN IS NOT THE GATE. firebase-provisioning re-derives the caller from
// their own JWT and checks is_admin server-side; this page being unlinked is
// cosmetic. It also asks for nothing and creates nothing — the function is
// read-only by design.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeError";

export const Route = createFileRoute("/_authenticated/app/admin/firebase")({
  head: () => ({
    meta: [{ title: "Firebase provisioning" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: FirebaseProvisioningTool,
});

function FirebaseProvisioningTool() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("firebase-provisioning", {
      body: {},
    });
    setBusy(false);
    // The server's own sentence is the one worth showing — a refusal from
    // Google names the role to grant, and a summary would lose it.
    setResult(error ? await edgeErrorMessage(error) : JSON.stringify(data, null, 2));
  };

  return (
    <div className="min-h-screen px-4 pt-12 pb-16">
      <h1 className="font-display text-2xl font-bold">Firebase provisioning</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Read-only. Asks Google what exists in the project: whether a web app is registered, whether
        Firestore is provisioned, and whether the service account may actually write to the Storage
        bucket. Creates nothing and writes nothing — the storage question is asked with
        testIamPermissions, which reports the permissions held without exercising them.
      </p>

      <button
        type="button"
        data-testid="firebase-provisioning-run"
        onClick={() => void run()}
        disabled={busy}
        className="press mt-4 rounded-full bg-world px-4 py-2 text-sm font-semibold text-on-world disabled:opacity-50"
      >
        {busy ? "Asking Google…" : "Check"}
      </button>

      {result ? (
        <pre
          data-testid="firebase-provisioning-result"
          className="mt-4 max-w-full overflow-x-auto rounded-2xl border border-border bg-card p-3 text-[11px] leading-relaxed"
        >
          {result}
        </pre>
      ) : null}
    </div>
  );
}
