// paymentRecoveryWorker — the worker that finishes what the webhook only
// PROMISED, as an exported handler rather than a second server.
//
// WHY IT IS A MODULE AND NOT ITS OWN FUNCTION. This project cannot add edge
// functions, so the worker is reached through an explicit, credential-gated
// mode on `razorpay-webhook`. A second `Deno.serve` here would be a second
// listener in one process; the entrypoint owns the socket and this owns the
// work, which is also what makes the whole thing testable by calling one
// exported function.
//
// THREE JOBS, ONE INVOCATION:
//   1. the inbox — verified events recorded by the webhook, not yet processed;
//   2. reconciliation — purchases whose event never arrived AT ALL, found by
//      asking the provider what payments an order has;
//   3. the tick — reaping leases whose worker died, and topping up the queue.
//
// ═══ NOTHING HERE MOVES MONEY OUT ═══
//
// Every provider call is a GET. A refund or a dispute becomes a CASE — facts,
// ownership, amounts, the provider's current state — and a person decides.
// There is no clawback, no refund, no payout, and the verbs do not appear.
//
// ═══ THE DEADLINE IS REAL, WHICH TAKES MORE THAN A TIMER AROUND THE LOOP ═══
//
// An earlier draft bounded the provider calls and left the DATABASE calls
// unbounded — and then read their bodies with a plain `res.text()`. A hung
// PostgREST read, or a response that never stops, would hold the invocation
// open past every deadline above it while the loop's own clock was checked
// only between items. So there is ONE fetch here, `boundedFetch`, and it is
// threaded through `resolveBinding`, `callGrantRpc`, the provider reads and
// the RPC helper alike: per-call abort, a body ceiling enforced while
// streaming, and a hard stop at the invocation's own deadline.

import {
  callGrantRpc,
  confirmAgainstBinding,
  isPlainRecord,
  isProviderId,
  readBoundedBody,
  readBoundedStream,
  resolveBinding,
  type ConfirmFailure,
  type PurchaseBinding,
} from "./razorpayConfirm.ts";
import { razorpayCreds, type RazorpayCreds } from "./razorpay.ts";
import {
  caseRank,
  CASE_OPEN_REASON,
  fetchOrderPayments,
  mayRecordFailure,
  pickCapturedPayment,
  redact,
} from "./paymentRecovery.ts";
import {
  caseMatchesBinding,
  fetchDisputeCase,
  fetchRefundCase,
  isCaseId,
  isMaterialAdverse,
  type CaseFacts,
} from "./razorpayCaseRead.ts";

// ───────────────────────── bounds ─────────────────────────

/** The whole invocation. Checked BETWEEN items, never inside one. */
export const WORKER_DEADLINE_MS = 50_000;
/** One network call. Also the headroom reserved before starting a new item. */
export const CALL_DEADLINE_MS = 10_000;
/** Any single response body, ours or the provider's. */
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024;
/** Finite batches, and no concurrency at all: work is strictly sequential. */
const INBOX_BATCH = 10;
const RECONCILE_BATCH = 5;
const LEASE_SECONDS = 120;

type Rest = { supabaseUrl: string; serviceKey: string };

type Ctx = {
  rest: Rest;
  creds: RazorpayCreds;
  deadlineAt: number;
  fetch: typeof fetch;
};

/**
 * The only fetch this module makes, in any direction.
 *
 * Three bounds at once: the call's own deadline, the invocation's remaining
 * time (whichever is sooner), and a body ceiling applied WHILE STREAMING. The
 * response is rebuilt from the bounded text, so every downstream reader —
 * `res.json()` in the binding resolver, `res.text()` in the grant helper — is
 * bounded whether or not it knows it. A 3xx is never followed: `redirect:
 * "manual"` is forced, so a gateway in front of PostgREST or the provider is a
 * refusal rather than a hop somewhere else.
 */
export function boundedFetch(deadlineAt: number, maxBytes = MAX_RESPONSE_BYTES): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error("worker-deadline");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(CALL_DEADLINE_MS, remaining));
    try {
      const res = await fetch(input, { ...init, redirect: "manual", signal: controller.signal });
      const read = await readBoundedStream(
        res.body,
        res.headers.get("content-length"),
        maxBytes,
        Math.min(CALL_DEADLINE_MS, Math.max(1, deadlineAt - Date.now())),
      );
      // A body we refused to read is not a body we may hand on half-parsed.
      if ("error" in read) throw new Error("bounded-read");
      return new Response(read.text, { status: res.status, headers: res.headers });
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}

// ───────────────────────── the entrypoint ─────────────────────────

/**
 * ONE exported handler. The webhook function routes to it and nothing else
 * does; it is never reachable without the server credential, which the caller
 * has already checked in constant time before this runs.
 */
export async function handlePaymentRecovery(
  req: Request,
  rest: Rest,
  headers: Record<string, string>,
): Promise<Response> {
  const reply = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  const read = await readBoundedBody(req, MAX_REQUEST_BYTES);
  if ("error" in read) return reply({ error: "bad request" }, 400);
  let body: unknown = {};
  if (read.text.trim() !== "") {
    try {
      body = JSON.parse(read.text);
    } catch {
      return reply({ error: "bad json" }, 400);
    }
  }
  if (!isPlainRecord(body)) return reply({ error: "bad json" }, 400);
  const action = typeof body.action === "string" ? body.action : "run";
  if (action !== "run" && action !== "probe") return reply({ error: "bad action" }, 400);

  const creds = razorpayCreds();

  // PROBE: READ-ONLY AND WRITE-FREE, so the cron credential can be checked the
  // day it is installed rather than the day a payment is lost. It touches no
  // table and calls no provider, which is the point — a probe needing the same
  // privileges as the work would be testing something else.
  if (action === "probe") {
    return reply({
      ok: true,
      mode: "recovery",
      action: "probe",
      configured: { supabase: true, razorpay: !("missing" in creds) },
    });
  }

  if ("missing" in creds) {
    console.error("payment-recovery missing razorpay credentials");
    return reply({ error: "not configured" }, 500);
  }

  const startedAt = Date.now();
  const deadlineAt = startedAt + WORKER_DEADLINE_MS;
  const ctx: Ctx = {
    rest,
    creds: creds.creds,
    deadlineAt,
    fetch: boundedFetch(deadlineAt),
  };

  try {
    // THE HEARTBEAT IS FIRST, AND IT IS A DIFFERENT FACT FROM THE RESPONSE. A
    // dispatch that 401s and one that never left cron look identical from the
    // database; this row says the credential was accepted and the handler ran.
    // Its failure is not fatal — a worker that cannot write a heartbeat can
    // still do the work, and refusing to would turn an observability gap into
    // an outage.
    await rpc(ctx, "payment_recovery_beat", {});
    // MAINTAIN, NEVER `payment_recovery_tick`. The tick POSTs this worker, so
    // calling it from here is a worker that summons a worker: one cron minute
    // fans out without bound. `payment_recovery_maintain` is the half that
    // touches only our own tables — reap both lease sets, top up the queue —
    // and it runs at the top of every invocation so a crashed worker's rows
    // are requeued now rather than at the next scheduled minute.
    const tick = await rpc(ctx, "payment_recovery_maintain", {});

    const inbox = await runInbox(ctx);
    const reconcile = await runReconcile(ctx);
    return reply({
      ok: true,
      mode: "recovery",
      elapsedMs: Date.now() - startedAt,
      tick: "error" in tick ? { error: redact(tick.error.code) } : tick.value,
      inbox,
      reconcile,
    });
  } catch {
    // The caught value is never logged: it can carry a request body, and a
    // webhook body carries a payer's contact details.
    console.error("payment-recovery worker error");
    return reply({ error: "Something went sideways" }, 500);
  }
}

/** Is there room for another whole item before the invocation must answer? */
function outOfTime(ctx: Ctx): boolean {
  return ctx.deadlineAt - Date.now() < CALL_DEADLINE_MS;
}

// ───────────────────────── counts ─────────────────────────

/**
 * Deliberately not one number.
 *
 * `done` is work that finished. `ignored`/`skipped` is work there was nothing
 * to do about. `leaseLost` is a REFUSAL: the lease expired, somebody else owns
 * the row, and whatever this worker decided was thrown away. Adding them
 * together would let an invocation that achieved nothing look busy.
 */
export type Counts = {
  claimed: number;
  done: number;
  ignored: number;
  skipped: number;
  retried: number;
  leaseLost: number;
  cases: number;
};

function emptyCounts(): Counts {
  return { claimed: 0, done: 0, ignored: 0, skipped: 0, retried: 0, leaseLost: 0, cases: 0 };
}

// ───────────────────────── the inbox ─────────────────────────

async function runInbox(ctx: Ctx): Promise<Counts | { error: string }> {
  const counts = emptyCounts();
  const claimed = await rpc(ctx, "payment_inbox_claim", {
    p_limit: INBOX_BATCH,
    p_lease_seconds: LEASE_SECONDS,
  });
  if ("error" in claimed) return { error: redact(claimed.error.code) };
  const rows = Array.isArray(claimed.value) ? claimed.value : [];
  counts.claimed = rows.length;

  for (const row of rows) {
    if (!isPlainRecord(row)) continue;
    // A claimed row this invocation has no time for is LEFT LEASED, not
    // abandoned mid-flight: the lease expires and the reaper requeues it. The
    // attempt was spent at claim time, which is what bounds a crash loop.
    if (outOfTime(ctx)) break;
    tally(counts, await processEvent(ctx, row));
  }
  return counts;
}

type Settled = {
  outcome: "done" | "ignored" | "retry" | "fatal";
  code: string;
  caseWritten?: true;
};

function tally(counts: Counts, r: Settled | "lease-lost") {
  if (r === "lease-lost") {
    counts.leaseLost += 1;
    return;
  }
  if (r.caseWritten) counts.cases += 1;
  if (r.outcome === "done") counts.done += 1;
  else if (r.outcome === "ignored") counts.ignored += 1;
  else counts.retried += 1;
}

async function processEvent(
  ctx: Ctx,
  row: Record<string, unknown>,
): Promise<Settled | "lease-lost"> {
  const id = typeof row.id === "string" ? row.id : null;
  const lease = typeof row.lease_token === "string" ? row.lease_token : null;
  if (!id || !lease) return { outcome: "ignored", code: "unclaimable-row" };

  const settled = await decideEvent(ctx, row);
  const finished = await rpc(ctx, "payment_inbox_complete", {
    p_id: id,
    p_lease: lease,
    p_outcome: settled.outcome,
    p_error: settled.code,
  });
  // LOSING THE LEASE IS A REFUSAL, NOT A SUCCESS. The row belongs to somebody
  // else now and whatever this worker just decided was discarded.
  if ("error" in finished) return "lease-lost";
  const v = finished.value;
  if (!isPlainRecord(v) || v.ok !== true) return "lease-lost";
  return settled;
}

/**
 * What should happen to one verified event.
 *
 * It decides and returns a CODE OF OURS; the caller is the only thing that
 * writes. Nothing from a provider body or a caught error reaches that code —
 * `redact` is the only way a string gets in.
 */
async function decideEvent(ctx: Ctx, row: Record<string, unknown>): Promise<Settled> {
  const eventClass = typeof row.event_class === "string" ? row.event_class : "other";
  const orderId = typeof row.provider_order_id === "string" ? row.provider_order_id : null;
  const paymentId = typeof row.provider_payment_id === "string" ? row.provider_payment_id : null;

  if (eventClass === "other") return { outcome: "ignored", code: "not-actionable" };

  if (!orderId || !isProviderId(orderId, "order")) {
    // A HANDLED event with no usable order id is not a shrug: the payload
    // shape may have moved, and a real payment may be behind it. Retried, and
    // exhaustion turns it into a case rather than a deletion.
    return { outcome: "retry", code: "no-order-id" };
  }

  const bound = await resolveBinding(ctx.rest, orderId, ctx.fetch);
  if ("error" in bound) {
    // `unknown-order` is RETRYABLE HERE even though the resolver calls it
    // final: an event can outrun our own insert. Every other verdict stands.
    const code = bound.error.code;
    const retry = bound.error.retryable || code === "unknown-order";
    return { outcome: retry ? "retry" : "fatal", code: redact(code) };
  }
  const binding = bound.binding;

  if (eventClass === "paid") return await settlePaid(ctx, binding, paymentId);
  if (eventClass === "failed") return await settleFailed(ctx, binding);
  return await settleCase(ctx, binding, row, eventClass);
}

async function settlePaid(
  ctx: Ctx,
  binding: PurchaseBinding,
  paymentId: string | null,
): Promise<Settled> {
  if (!paymentId || !isProviderId(paymentId, "pay")) {
    // `order.paid` with no payment entity. Razorpay usually also sends
    // `payment.captured`, but that is not guaranteed to arrive or to arrive
    // first, so this waits rather than being written off.
    return { outcome: "retry", code: "no-payment-id" };
  }
  const confirmed = await confirmAgainstBinding(ctx.creds, binding, paymentId, ctx.fetch);
  if ("error" in confirmed) return fromFailure(confirmed.error);

  const granted = await callGrantRpc(
    ctx.rest,
    binding.creditRpc,
    {
      _provider_order_id: binding.providerOrderId,
      _provider_payment_id: paymentId,
      _confirmed_by: "webhook",
    },
    ctx.fetch,
  );
  if ("error" in granted) {
    // `grant-refused` is a 200 carrying ok:false. The RPCs are idempotent and
    // a refusal can be a race with the callback, so it is retried rather than
    // written off — and exhaustion files it for a person.
    return { outcome: "retry", code: redact(granted.error.code) };
  }
  return { outcome: "done", code: "granted" };
}

async function settleFailed(ctx: Ctx, binding: PurchaseBinding): Promise<Settled> {
  // A STALE FAILURE MAY NOT DOWNGRADE A PAID PURCHASE. Deliveries are
  // unordered, so a `payment.failed` can land after the capture that
  // superseded it. There is nothing to retry about that: it is settled.
  if (!mayRecordFailure(binding)) return { outcome: "ignored", code: "already-settled" };

  const marked = await callGrantRpc(
    ctx.rest,
    binding.failRpc,
    {
      _provider_order_id: binding.providerOrderId,
      // A GENERIC CODE, NEVER THE PROVIDER'S `error_description`. That string
      // is free text from outside, it reaches a person's screen, and it has no
      // bound worth relying on. Our own vocabulary is enough to act on.
      _error: "payment-failed",
    },
    ctx.fetch,
    binding.failShape,
  );
  if ("error" in marked) return { outcome: "retry", code: redact(marked.error.code) };
  return { outcome: "done", code: "failure-recorded" };
}

/**
 * A refund or a dispute becomes a case, and the provider is ASKED what is true
 * before anything is written — the event name only says how stale the delivery
 * is, never what state the case is in.
 */
async function settleCase(
  ctx: Ctx,
  binding: PurchaseBinding,
  row: Record<string, unknown>,
  kind: string,
): Promise<Settled> {
  const eventName = typeof row.event_name === "string" ? row.event_name : "";
  const paymentId = typeof row.provider_payment_id === "string" ? row.provider_payment_id : null;
  const caseId =
    kind === "refund"
      ? typeof row.provider_refund_id === "string"
        ? row.provider_refund_id
        : null
      : typeof row.provider_dispute_id === "string"
        ? row.provider_dispute_id
        : null;
  const prefix = kind === "refund" ? "rfnd" : "disp";
  if (!caseId || !isCaseId(caseId, prefix)) {
    // The delivery stays visible rather than vanishing: an event of a class we
    // DO act on, whose subject we cannot name, is worth somebody's attention.
    return { outcome: "retry", code: "no-case-id" };
  }

  const got =
    kind === "refund"
      ? await fetchRefundCase(ctx.creds, caseId, ctx.fetch)
      : await fetchDisputeCase(ctx.creds, caseId, ctx.fetch);
  if ("error" in got) return fromFailure(got.error);
  const facts = got.facts;

  const matched = caseMatchesBinding(facts, binding, paymentId);
  if (!matched.ok) return { outcome: "fatal", code: redact(matched.error.code) };

  const written = await writeCase(ctx, binding, facts, eventName);
  if ("error" in written) return { outcome: "retry", code: redact(written.error) };
  // A SEMANTIC REFUSAL IS NOT A SUCCESS. `linkage-conflict` means the case row
  // refused this binding and applied NOTHING; `conflict` means two terminal
  // events disagree and a person must look. Both already wrote durable history
  // and an ops alert, so retrying spends attempts on a decision no retry can
  // make — but calling them `done` would report the event as processed when its
  // content was discarded.
  if (written.outcome === "linkage-conflict" || written.outcome === "conflict") {
    return { outcome: "ignored", code: `case-${written.outcome}`, caseWritten: true };
  }
  return { outcome: "done", code: `case-${written.outcome}`, caseWritten: true };

}

async function writeCase(
  ctx: Ctx,
  binding: PurchaseBinding,
  facts: CaseFacts,
  eventName: string,
): Promise<{ ok: true; outcome: string } | { error: string }> {

  const called = await rpc(ctx, "payment_case_upsert", {
    p_case_type: facts.kind,
    p_case_id: facts.caseId,
    p_order: binding.providerOrderId,
    p_payment: facts.paymentId,
    p_event: eventName,
    p_rank: caseRank(eventName),
    // THE CASE'S OWN AMOUNT. A partial refund is recorded as the partial
    // amount; the payment's total never stands in for it.
    p_amount: facts.amountMinor,
    p_user: binding.userId,
    p_table: binding.table,
    p_open_reason: CASE_OPEN_REASON,
    // A closed case reopens only on news that actually went against us.
    p_material_adverse: isMaterialAdverse(facts),
    p_currency: facts.currency,
    // THE FRESH READ TRAVELS SEPARATELY FROM THE EVENT RANK. A dispute cycles,
    // so the rank decides whether this DELIVERY is stale while the verified
    // status records what the provider says right now. A case nobody has
    // re-read shows as unverified rather than as agreed.
    p_verified_status: facts.status,
  });
  if ("error" in called) return { error: called.error.code };
  if (!isPlainRecord(called.value)) return { error: "case-bad-result" };
  // The RPC's own verdict travels back. An unrecognised one is a contract drift
  // and is treated as a failure rather than assumed benign.
  const outcome = called.value.outcome;
  if (
    typeof outcome !== "string" ||
    !["opened", "advanced", "reopened", "stale", "conflict", "linkage-conflict"].includes(outcome)
  ) {
    return { error: "case-unknown-outcome" };
  }
  return { ok: true, outcome };

}

/** A provider/evidence failure, mapped onto an inbox outcome. */
function fromFailure(error: ConfirmFailure): Settled {
  return { outcome: error.retryable ? "retry" : "fatal", code: redact(error.code) };
}

// ───────────────────────── reconciliation ─────────────────────────

/**
 * The purchases whose event never arrived at all.
 *
 * Found by asking the provider what payments an order has, with the SAME
 * parser and the same singular-exact-match rule the callback uses — a second,
 * looser reading of the same evidence would mean the recovery path granting on
 * things the ordinary path refuses.
 */
async function runReconcile(ctx: Ctx): Promise<Counts | { error: string }> {
  const counts = emptyCounts();
  const claimed = await rpc(ctx, "payment_reconcile_claim", {
    p_limit: RECONCILE_BATCH,
    p_lease_seconds: LEASE_SECONDS,
  });
  if ("error" in claimed) return { error: redact(claimed.error.code) };
  const rows = Array.isArray(claimed.value) ? claimed.value : [];
  counts.claimed = rows.length;

  for (const row of rows) {
    if (!isPlainRecord(row)) continue;
    if (outOfTime(ctx)) break;
    const table = typeof row.purchase_table === "string" ? row.purchase_table : null;
    const order = typeof row.provider_order_id === "string" ? row.provider_order_id : null;
    const lease = typeof row.lease_token === "string" ? row.lease_token : null;
    if (!table || !order || !lease) continue;

    const decided = await decideReconcile(ctx, order);
    const finished = await rpc(ctx, "payment_reconcile_complete", {
      p_table: table,
      p_order: order,
      p_lease: lease,
      p_outcome: decided.outcome,
      p_error: decided.code,
    });
    const v = "error" in finished ? null : finished.value;
    if (!isPlainRecord(v) || v.ok !== true) {
      counts.leaseLost += 1;
      continue;
    }
    if (decided.outcome === "resolved") counts.done += 1;
    else if (decided.outcome === "skipped") counts.skipped += 1;
    else counts.retried += 1;
  }
  return counts;
}

type Reconciled = { outcome: "resolved" | "skipped" | "retry"; code: string };

async function decideReconcile(ctx: Ctx, order: string): Promise<Reconciled> {
  const bound = await resolveBinding(ctx.rest, order, ctx.fetch);
  if ("error" in bound) {
    const code = bound.error.code;
    return {
      outcome: bound.error.retryable || code === "unknown-order" ? "retry" : "skipped",
      code: redact(code),
    };
  }
  const binding = bound.binding;

  // Already settled by somebody — the callback, the webhook, an earlier tick.
  if (binding.storedPaymentId) return { outcome: "skipped", code: "already-settled" };

  const listed = await fetchOrderPayments(ctx.creds, order, ctx.fetch);
  if ("error" in listed) {
    return {
      outcome: listed.error.retryable ? "retry" : "skipped",
      code: redact(listed.error.code),
    };
  }
  const picked = pickCapturedPayment(listed.items, binding);
  if ("error" in picked) {
    const code = picked.error.code;
    // NOTHING TO DO IS NOT SUCCESS, and it is not a fault either. An order
    // with no captured payment is an unpaid order: the ordinary case, reported
    // as `skipped` so a tick that achieved nothing cannot read as a tick that
    // fixed something.
    if (code === "no-captured-payment") return { outcome: "skipped", code };
    return { outcome: picked.error.retryable ? "retry" : "skipped", code: redact(code) };
  }

  const granted = await callGrantRpc(
    ctx.rest,
    binding.creditRpc,
    {
      _provider_order_id: binding.providerOrderId,
      _provider_payment_id: picked.payment.id,
      // THE HONEST LABEL, AND IT IS CURRENTLY REFUSED FOR FOOD ORDERS.
      // `mark_order_paid` rejects `_confirmed_by = 'reconcile'` for EVERY food
      // row, not only failed ones — so reconciliation of a food purchase
      // cannot succeed until the next grant-SQL cycle widens that contract.
      // Passing 'webhook' to slip past the check would be recording a client
      // confirmation that never happened, in the row somebody later audits.
      // The refusal below keeps it visible instead.
      _confirmed_by: "reconcile",
    },
    ctx.fetch,
  );
  if ("error" in granted) {
    // A SEMANTIC REFUSAL IS NOT `resolved`. Marking it so would close the only
    // record that somebody may still be owed their purchase. It is retried,
    // and exhaustion files it as a manual-review case with an alert — where it
    // stays until the grant-SQL cycle fixes the contract.
    return { outcome: "retry", code: redact(granted.error.code) };
  }
  return { outcome: "resolved", code: "granted" };
}

// ───────────────────────── plumbing ─────────────────────────

/**
 * Call one recovery RPC and hand back whatever JSON it produced.
 *
 * Deliberately NOT `callGrantRpc`: that helper demands `{ok:true}`, which is
 * the right contract for a grant and the wrong one here — `payment_inbox_claim`
 * answers with an ARRAY of rows, and the completion RPCs answer `{ok:false}`
 * to mean "your lease is gone", which is a result to read rather than a
 * transport error. It goes through the bounded fetch like everything else, so
 * there is no unbounded `res.text()` on this path.
 */
async function rpc(
  ctx: Ctx,
  name: string,
  args: Record<string, unknown>,
): Promise<{ value: unknown } | { error: ConfirmFailure }> {
  let res: Response;
  try {
    res = await ctx.fetch(`${ctx.rest.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: ctx.rest.serviceKey,
        Authorization: `Bearer ${ctx.rest.serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
  } catch {
    return { error: { code: "rpc-unreachable", retryable: true } };
  }
  if (!res.ok) return { error: { code: `rpc-http-${res.status}`, retryable: true } };
  // Already bounded by `boundedFetch`, which rebuilt this response from a
  // capped read — there is no unbounded body left to consume here.
  const raw = await res.text().catch(() => null);
  if (raw === null) return { error: { code: "rpc-read-failed", retryable: true } };
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null") return { value: null };
  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    return { error: { code: "rpc-bad-json", retryable: true } };
  }
}

/**
 * Compare two secrets without leaking which byte differed — OR HOW LONG THE
 * EXPECTED ONE IS.
 *
 * `a === b` short-circuits, and a byte-wise loop still returns early on a
 * length mismatch. Both sides are digested first, so the comparison is always
 * over exactly 32 bytes whatever was presented, and the XOR accumulates
 * instead of branching. It compares the CREDENTIAL, never a claim a token
 * makes about itself: a `role` claim is something anyone can write.
 */
export async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
