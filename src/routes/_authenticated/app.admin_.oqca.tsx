// ADMIN-ONLY tool: OQCA's first caller in the app.
//
// WHY A SCREEN EXISTS FOR THIS AT ALL. The owner, 2026-09-11: "Everything else
// — the substrate, the autonomy runtime, the self-improvement loop — has no
// caller in the app at all add it." Nine versions of a cognitive kernel, a
// knowledge substrate, an autonomous runtime and a self-improvement episode,
// every one of them reachable only from a script on a developer's disk. This
// is the button that runs them against ONIQ's own production state.
//
// THE TRAILING UNDERSCORE IS LOAD-BEARING. `app.admin_.oqca.tsx` opts OUT of
// nesting under `app.admin.tsx`, which is the Moderation inbox and renders no
// <Outlet />. Without it this route mounts the inbox and the tool never appears
// — measured on 2026-09-07, when three admin tools had never once rendered for
// anyone. `routeNesting.test.ts` is the guard; the URL is unchanged either way.
//
// A TAP IS NOT A DAEMON, AND IT COSTS NOTHING. The shipped budgets carry
// maxTokens, maxCostUsd and maxToolCalls at 0, so every model call is refused
// at its own gate and no tool touches production. What a scheduled cognitive
// loop may spend is a provider-and-payment decision and therefore the owner's;
// a button spends what the person who pressed it chose to, which is nothing.
//
// THE SCREEN IS NOT THE GATE. oqca-observe re-derives the caller from their own
// JWT and checks is_admin server-side.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeError";

export const Route = createFileRoute("/_authenticated/app/admin_/oqca")({
  head: () => ({
    meta: [{ title: "OQCA" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: OqcaTool,
});

function OqcaTool() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("oqca-observe", { body: {} });
    setBusy(false);
    // The server's own answer is the one worth showing. A summary would lose
    // the six planning factors, and the 2026-09-11 ranking defect was invisible
    // until those were printed rather than reasoned about.
    setResult(error ? await edgeErrorMessage(error) : JSON.stringify(data, null, 2));
  };

  return (
    <div className="min-h-screen px-4 pt-12 pb-16">
      <h1 className="font-display text-2xl font-bold">OQCA</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Reads five things from ONIQ&rsquo;s own production tables — the film dispatcher, the film
        queue, the renderer, the client error reports and OQCA&rsquo;s durable store — ranks what is
        worth looking at, retrieves evidence from those readings, verifies it, writes what it
        learned to a table that outlives the tap, and runs the 23 cognitive stations against it.
      </p>
      <p className="mt-2 max-w-prose text-xs text-muted-foreground">
        Spends nothing: the execution budgets ship at zero, so every model call is refused at its
        gate and no tool writes anywhere. It changes no configuration and deploys nothing — the six
        capabilities that could are registered and not authorized, and the run says so by name.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="oqca-observe-run"
          onClick={() => void run()}
          disabled={busy}
          className="press rounded-full bg-world px-4 py-2 text-sm font-semibold text-on-world disabled:opacity-50"
        >
          {busy ? "Observing…" : "Observe ONIQ"}
        </button>
      </div>

      <p className="mt-2 max-w-prose text-xs text-muted-foreground">
        Each tap starts from what the last one learned. A reading the server could not take is
        reported as unobserved rather than as healthy — &ldquo;nobody looked&rdquo; and
        &ldquo;looked and it is fine&rdquo; are different answers.
      </p>

      {result !== null && (
        <pre
          data-testid="oqca-observe-result"
          className="mt-4 max-h-[70vh] overflow-auto rounded-2xl bg-muted p-3 text-xs whitespace-pre-wrap"
        >
          {result}
        </pre>
      )}
    </div>
  );
}
