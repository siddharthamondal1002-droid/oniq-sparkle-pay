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
//
// THE BRIDGE CHECK BESIDE IT is the other half, added 2026-09-05 with the
// server-side route: it round-trips ONE document and ONE small file through
// the caller's own subtree and deletes both. "Deployed" and "working" are
// different claims, and only the second is worth anything.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeError";
import { firebaseBridge } from "@/lib/firebaseBridge.functions";

export const Route = createFileRoute("/_authenticated/app/admin_/firebase")({
  head: () => ({
    meta: [{ title: "Firebase provisioning" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: FirebaseProvisioningTool,
});

function FirebaseProvisioningTool() {
  const [busy, setBusy] = useState<null | "probe" | "bridge" | "voice">(null);
  const [result, setResult] = useState<string | null>(null);
  const runBridge = useServerFn(firebaseBridge);

  const run = async () => {
    setBusy("probe");
    setResult(null);
    const { data, error } = await supabase.functions.invoke("firebase-provisioning", {
      body: {},
    });
    setBusy(null);
    // The server's own sentence is the one worth showing — a refusal from
    // Google names the role to grant, and a summary would lose it.
    setResult(error ? await edgeErrorMessage(error) : JSON.stringify(data, null, 2));
  };

  // The voice-replication question, asked with the verb that matters. See the
  // probe's own comment in voice-clone for why a GET could never answer it.
  const voice = async () => {
    setBusy("voice");
    setResult(null);
    const { data, error } = await supabase.functions.invoke("voice-clone", {
      body: { action: "probe" },
    });
    setBusy(null);
    setResult(error ? await edgeErrorMessage(error) : JSON.stringify(data, null, 2));
  };

  const bridge = async () => {
    setBusy("bridge");
    setResult(null);
    try {
      const data = await runBridge({ data: { action: "selftest" } });
      setResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setResult((e as Error).message);
    }
    setBusy(null);
  };

  return (
    <div className="min-h-screen px-4 pt-12 pb-16">
      <h1 className="font-display text-2xl font-bold">Firebase provisioning</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Read-only. Asks Google what exists in the project: whether a web app is registered, whether
        Firestore is provisioned, and whether the service account may actually write to the Storage
        bucket. Creates nothing and writes nothing — the storage question is asked with
        testIamPermissions, which reports the permissions held without exercising them. It also
        re-runs the Vertex voice-catalogue call that refused with a named IAM permission, so a grant
        can be checked by what Google says rather than by what a console shows.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="firebase-provisioning-run"
          onClick={() => void run()}
          disabled={busy !== null}
          className="press rounded-full bg-world px-4 py-2 text-sm font-semibold text-on-world disabled:opacity-50"
        >
          {busy === "probe" ? "Asking Google…" : "Check"}
        </button>

        <button
          type="button"
          data-testid="voice-clone-probe"
          onClick={() => void voice()}
          disabled={busy !== null}
          className="press rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {busy === "voice" ? "Asking Vertex…" : "Voice replication"}
        </button>

        <button
          type="button"
          data-testid="firebase-bridge-selftest"
          onClick={() => void bridge()}
          disabled={busy !== null}
          className="press rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {busy === "bridge" ? "Round-tripping…" : "Bridge check"}
        </button>
      </div>

      <p className="mt-2 max-w-prose text-xs text-muted-foreground">
        Bridge check writes one document and one tiny file into your own space through the backend
        service account, reads them back, then deletes both.
      </p>

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
