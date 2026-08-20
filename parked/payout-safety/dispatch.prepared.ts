// P1 PREPARED — replacement for the `if (body?.runPayouts === true) { … }`
// block in supabase/functions/razorpay-order/index.ts (currently lines 84–175).
// NOT wired into the live function yet; promotion is owner-gated (see README).
//
// The shape is unchanged: admin-only, compute the run, then drain the queue in
// bounded rounds. What changes is that every step is now concurrency-safe and
// every failure is observable:
//
//   * reap_stuck_payouts runs FIRST, so a row stranded 'processing' by a prior
//     crashed/timed-out run is requeued (or parked 'unknown') before this run
//     claims anything.
//   * claim_payout_batch now atomically moves rows queued → processing, so two
//     overlapping runs can never both take the same row.
//   * each payout is classified: paid / failed / unknown. UNKNOWN (a lost
//     response or a retriable status) leaves the row 'processing' — never
//     'failed' — for the reaper + idempotent re-POST to resolve.
//   * mark_payout_result's answer is READ, not swallowed. A mark that did not
//     land is logged and counted; the row stays 'processing' and the reaper +
//     idempotency key make the eventual retry safe.
//
// The idempotency key is item.id (the queue row id), passed as referenceId to
// createRazorpayPayout, which now sends it as X-Payout-Idempotency.
//
// This mirrors src/lib/creator/payoutClassify.ts. The two must agree; a test
// pins the retriable-status set in both.

// --- inlined classifier (Deno edge cannot import from src/) --------------------
const RETRIABLE_HTTP = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

type PayoutObservation =
  | { kind: "ok"; providerId: string; status: string }
  | { kind: "http"; status: number; providerError?: string }
  | { kind: "transport"; message: string };

function classifyPayout(obs: PayoutObservation): {
  outcome: "paid" | "failed" | "unknown";
  leaveProcessing: boolean;
  reason: string;
} {
  if (obs.kind === "ok") {
    return { outcome: "paid", leaveProcessing: false, reason: `provider payout ${obs.providerId}` };
  }
  if (obs.kind === "transport") {
    return {
      outcome: "unknown",
      leaveProcessing: true,
      reason: `transport error, result unknown: ${obs.message}`.slice(0, 280),
    };
  }
  if (obs.status >= 200 && obs.status < 300) {
    return { outcome: "unknown", leaveProcessing: true, reason: "2xx without a payout id" };
  }
  if (RETRIABLE_HTTP.has(obs.status)) {
    return {
      outcome: "unknown",
      leaveProcessing: true,
      reason: `retriable ${obs.status}: ${obs.providerError ?? ""}`.slice(0, 280),
    };
  }
  return {
    outcome: "failed",
    leaveProcessing: false,
    reason: `provider rejected ${obs.status}: ${obs.providerError ?? ""}`.slice(0, 280),
  };
}

// --- the dispatch block (drop-in for the runPayouts branch) --------------------
// The surrounding function already has: supabaseUrl, serviceKey, userId, body,
// creds, and the json() helper in scope.
export async function runPayoutsBranch(ctx: {
  supabaseUrl: string;
  serviceKey: string;
  userId: string;
  body: Record<string, unknown>;
  creds: RazorpayCreds;
  json: (payload: unknown, status?: number) => Response;
  createRazorpayPayout: (
    creds: RazorpayCreds,
    accountNumber: string,
    p: { amountPaise: number; vpa: string; recipientName: string; referenceId: string },
  ) => Promise<PayoutObservation>;
}): Promise<Response> {
  const { supabaseUrl, serviceKey, userId, body, creds, json, createRazorpayPayout } = ctx;
  const svcHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  // Admin only — this moves real money out of the RazorpayX account.
  const adminRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=is_admin&limit=1`,
    { headers: svcHeaders },
  );
  const adminRow = adminRes.ok ? ((await adminRes.json())[0] ?? null) : null;
  if (adminRow?.is_admin !== true) return json({ error: "admins only" }, 403);

  // Compute the run (creator + subscriber legs queued in one transaction).
  const runRes = await fetch(`${supabaseUrl}/rest/v1/rpc/run_creator_payouts`, {
    method: "POST",
    headers: { ...svcHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      _pool_paise: Number.isInteger(body?.poolPaise) ? body.poolPaise : null,
    }),
  });
  if (!runRes.ok) {
    const detail = await runRes.text().catch(() => "");
    console.error("payout run rpc", runRes.status, detail.slice(0, 200));
    return json({ error: "could not compute the payout run" }, 502);
  }
  const run = (await runRes.json()) as Record<string, unknown>;

  const accountNumber = Deno.env.get("RAZORPAYX_ACCOUNT_NUMBER");
  if (!accountNumber) {
    return json({
      ok: true,
      run,
      dispatched: 0,
      note: "RAZORPAYX_ACCOUNT_NUMBER is not set — payouts are queued, not sent.",
    });
  }

  // SELF-HEAL FIRST. Requeue rows a prior crashed/timed-out run left stuck in
  // 'processing'; the idempotency key makes their re-POST safe.
  let reaped: unknown = null;
  const reapRes = await fetch(`${supabaseUrl}/rest/v1/rpc/reap_stuck_payouts`, {
    method: "POST",
    headers: { ...svcHeaders, "content-type": "application/json" },
    body: JSON.stringify({ _older_than_minutes: 15, _max_attempts: 5 }),
  });
  if (reapRes.ok) reaped = await reapRes.json().catch(() => null);
  else console.error("reap_stuck_payouts", reapRes.status);

  let dispatched = 0;
  let failed = 0;
  let noMethod = 0;
  let unknown = 0;
  let markMisses = 0;

  for (let round = 0; round < 5; round++) {
    // Atomic claim: these rows are now 'processing', invisible to any other run.
    const batchRes = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_payout_batch`, {
      method: "POST",
      headers: { ...svcHeaders, "content-type": "application/json" },
      body: JSON.stringify({ _limit: 20 }),
    });
    if (!batchRes.ok) break;
    const batch = (await batchRes.json()) as {
      id: string;
      recipientId: string;
      amountPaise: number;
      kind: string;
      vpa: string | null;
    }[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const item of batch) {
      // mark returns { updated, status }; a mark that did not land is surfaced,
      // never swallowed. The row stays 'processing' and the reaper + idempotency
      // key resolve it on a later run without paying twice.
      const mark = async (status: string, providerId?: string, error?: string) => {
        try {
          const r = await fetch(`${supabaseUrl}/rest/v1/rpc/mark_payout_result`, {
            method: "POST",
            headers: { ...svcHeaders, "content-type": "application/json" },
            body: JSON.stringify({
              _id: item.id,
              _status: status,
              _provider_payout_id: providerId ?? null,
              _error: error ?? null,
            }),
          });
          if (!r.ok) {
            markMisses++;
            console.error("mark_payout_result http", r.status, item.id);
            return;
          }
          const res = (await r.json().catch(() => null)) as { updated?: boolean } | null;
          if (!res?.updated) {
            markMisses++;
            console.error("mark_payout_result no-op (row not processing)", item.id, status);
          }
        } catch (e) {
          markMisses++;
          console.error("mark_payout_result threw", item.id, e);
        }
      };

      if (!item.vpa) {
        noMethod++;
        await mark("no_method", undefined, "no UPI ID on file");
        continue;
      }

      const obs = await createRazorpayPayout(creds, accountNumber, {
        amountPaise: item.amountPaise,
        vpa: item.vpa,
        recipientName: item.kind === "creator" ? "ONIQ creator" : "ONIQ subscriber",
        referenceId: item.id, // idempotency key
      });
      const decision = classifyPayout(obs);

      if (decision.outcome === "paid") {
        dispatched++;
        await mark("paid", obs.kind === "ok" ? obs.providerId : undefined, decision.reason);
      } else if (decision.outcome === "failed") {
        failed++;
        await mark("failed", undefined, decision.reason);
      } else {
        // UNKNOWN — leave the row 'processing'. Do NOT mark failed; the reaper
        // requeues it and the idempotent re-POST cannot double-pay.
        unknown++;
        console.error("payout unknown, left processing for reaper", item.id, decision.reason);
      }
    }
    if (batch.length < 20) break;
  }

  return json({ ok: true, run, reaped, dispatched, failed, noMethod, unknown, markMisses });
}

// Present only so this prepared file type-checks in isolation; the live file
// imports the real RazorpayCreds.
type RazorpayCreds = { keyId: string; keySecret: string };
declare const Deno: { env: { get(k: string): string | undefined } };
