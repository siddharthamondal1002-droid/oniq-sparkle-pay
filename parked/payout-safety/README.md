# P1 — Creator Program payout double-spend: prepared, NOT executed

**Status:** engineering complete, verified locally, **awaiting owner approval for
the production money-path change.** Nothing here is applied. The migration is
parked (not under `supabase/migrations/`) precisely so Lovable cannot auto-apply
it on a `main` build; the edge-function changes are parked so a routine
edge-function deploy cannot ship them.

This concerns **Track A** — the RazorpayX Creator Program dispatch
(`run_creator_payouts` → `payout_queue` → `claim_payout_batch` →
`createRazorpayPayout`). It does **not** touch Track B (the Play-subscription
creator payouts in `20260819075744_*.sql`, `payouts_enabled=false`), which
already has its own idempotency (`creator_payout_attempts.idempotency_key`).

---

## 1. The vulnerability (confirmed on `main` @ 50451594)

Three independent ways one creator/subscriber gets paid more than once:

- **Non-atomic claim.** `claim_payout_batch` is a plain `SELECT ... WHERE status
  = 'queued'`. It marks nothing. Two overlapping dispatch runs — an admin double
  tap, or a retry after the edge function's 60s client timeout — both read the
  same queued rows and both pay them.
- **Swallowed mark.** The dispatcher's `mark` helper ends in `.catch(() => {})`,
  and `mark_payout_result` only transitions **from `queued`**. A mark that fails
  after a *successful* payout leaves the row `queued` → re-claimed next run →
  paid again.
- **No provider idempotency.** `createRazorpayPayout` sends no
  `X-Payout-Idempotency` header. `reference_id` is set but RazorpayX does not
  enforce its uniqueness by default, so a resend is a second real payout.

**Failure → money impact:** real INR leaves the RazorpayX account 2×+ per
affected recipient. A duplicated run at 10,000-subscriber scale can re-disburse
an entire period pool. (Latent today unless `RAZORPAYX_ACCOUNT_NUMBER` is set
and an admin runs a dispatch; `creator_program_config.enabled` defaults true.)

## 2. The fix

- **Atomic claim** — `claim_payout_batch` becomes `... FOR UPDATE SKIP LOCKED`
  inside a CTE that `UPDATE`s the picked rows `queued → processing ... RETURNING`.
  One row → one active processor; a concurrent claim skips locked/processing rows.
- **Guarded, idempotent mark** — `mark_payout_result` transitions **only from
  `processing`** and returns `{updated,status}`. An already-`paid` row is a no-op.
- **Reaper** — `reap_stuck_payouts` requeues `processing` rows older than the
  timeout (crash recovery); after an attempts cap it parks them `unknown` (true
  provider state undetermined — reconcile by hand, never re-sent on a guess).
- **Provider idempotency** — `X-Payout-Idempotency: <queue row id>` on the payout
  POST. A retry with the same key returns the original payout, not a second one.
- **Observable dispatch** — outcomes classified `paid`/`failed`/`unknown`;
  `unknown` leaves the row `processing` (never `failed`); mark results are read,
  not swallowed.

State machine: `queued → processing → {paid | failed | no_method}`;
`processing → queued` (reaper, retriable) or `processing → unknown` (reaper,
exhausted). Only `queued` is claimable.

## 3. Files

| Prepared artifact | Promotes to |
|---|---|
| `20260820090000_payout_concurrency_safety.sql` | `supabase/migrations/20260820090000_payout_concurrency_safety.sql` |
| `razorpay.payout.prepared.ts` | replaces `createRazorpayPayout` in `supabase/functions/_shared/razorpay.ts` |
| `dispatch.prepared.ts` | replaces the `runPayouts` branch in `supabase/functions/razorpay-order/index.ts` |
| `src/lib/creator/payoutClassify.ts` (shipped) | the tested spec the edge classifier mirrors |
| `src/lib/creator/__tests__/payoutConcurrency.test.ts` (shipped) | the guard suite |

## 4. Tests

`payoutConcurrency.test.ts` — 22 assertions. Behavioural unit tests of
`classifyPayout` (the safe-retry decision), plus source assertions pinning each
concurrency mechanism, one `it` per audit scenario (TEST 1–10). Plus a guard
that the migration is **not** in `supabase/migrations/` (i.e. not auto-applied).

**Limitation, stated plainly:** a vitest process has no multi-connection
Postgres, so scenarios 1/2/10 are proven at the *mechanism* level (the
`FOR UPDATE SKIP LOCKED` claim is present), not by a live race. Postgres'
partitioning of SKIP-LOCKED rows is a given; a **live multi-worker race on a
staging Postgres** is the pre-production confirmation (see §7).

## 5. Why production approval is still required

Applying the migration and deploying the edge changes moves the real
money-movement code. Per `CLAUDE.md`, money-path changes are the owner's call;
per this task, the final production step is explicitly gated. Also: idempotency
correctness depends on RazorpayX honouring `X-Payout-Idempotency` for the
account's API mode — confirm on a **RazorpayX test/staging account** first.

## 6. Exact production steps (owner-run, in order)

```
# 1. Promote the migration into the auto-applied path.
git mv parked/payout-safety/20260820090000_payout_concurrency_safety.sql \
       supabase/migrations/20260820090000_payout_concurrency_safety.sql

# 2. Promote the edge changes into the live functions (apply by hand or via the
#    prepared diffs): createRazorpayPayout ← razorpay.payout.prepared.ts;
#    runPayouts branch ← dispatch.prepared.ts. Keep the shipped classifier set
#    in sync (the guard test enforces this).

# 3. Land on main; Lovable applies the migration on the next backend build.
#    Then deploy the edge functions explicitly (they do NOT deploy with a web
#    publish) via the Lovable agent: supabase--deploy_edge_functions.

# 4. Post-migration verification (see §7) BEFORE enabling a real run.
```

## 7. Pre-production verification (staging)

1. Apply the migration to a staging DB. Confirm the new columns/constraint/
   functions exist and no `payout_queue` row is in a state outside the new
   constraint.
2. **Live concurrency:** seed N queued rows; fire two dispatch invocations
   simultaneously against staging; assert exactly N distinct payouts and no row
   paid twice.
3. **Crash recovery:** claim a batch, kill the worker before mark; run the
   reaper; confirm the row requeues and the idempotent re-POST returns the same
   payout id.
4. **Idempotency:** on a RazorpayX test account, POST the same payout twice with
   the same `X-Payout-Idempotency`; confirm one payout, same id both times.

## 8. Observability

`payout_queue.(status, claimed_at, attempts, provider_payout_id, error)` now
tell the whole story per row. The dispatch response reports
`{dispatched, failed, noMethod, unknown, markMisses, reaped}`. Alert on any row
in `unknown`, and on `markMisses > 0`.

## 9. Rollback

The migration is additive; a rollback block is included as a comment at the foot
of the SQL. **Caveat:** if any row is already in `processing`/`unknown` when a
rollback runs, resolve those rows by hand first (reconcile against RazorpayX by
`reference_id`) — reverting the claim to SELECT-only while rows sit `processing`
would strand them. Leaving the wider status constraint and the two new columns
in place is harmless and is the safer partial rollback.

## 10. Expected downtime / locking

None. `ALTER TABLE ... ADD COLUMN` with defaults on modern Postgres is
metadata-only; the new indexes are small; `CREATE OR REPLACE FUNCTION` does not
lock the table. Run when no dispatch is in flight.
