# Payment confirmation — closing the five open issues

Inspection is done at HEAD `e9710417d54b64d11441e19844da81864638c032` (worktree clean). Nothing below duplicates an existing implementation: the searches for a webhook/event/inbox/refund/dispute table returned **none**, so issues 1–2 are genuinely unbuilt, while the scheduler, admin permission check and alerting they need **already exist** and will be reused rather than rebuilt.

## What already exists (reuse, do not rebuild)

| Need | Existing thing |
|---|---|
| Scheduler | `pg_cron`, 6 live jobs (`ops-watchdog` `*/5`, `story-sweep` `*/15`, `message-push-backstop` `* * * * *`) |
| Admin permission | `public.is_admin(uuid)` SECURITY DEFINER; admin screen `app.admin.tsx` with `reports / payouts / errors / billing` sections |
| Operational alerts | `ops_alerts` ledger + `ops_watch_health` + `ops-alert` function (push to devices), one-open-row-per-signal unique index |
| Product/RPC map | `PRODUCTS` in `_shared/razorpayConfirm.ts` — all five products, credit/fail RPC and return shape in one table |
| Duplicate order reuse | `razorpay-order` already reuses an open `payments` row per food order |

## The five issues and how each is closed

### 1. Durable signed-webhook inbox with dedup + leased retry worker
Today the webhook returns `503` and relies wholly on Razorpay's own retry window; once that window closes a captured payment is lost. Add `payment_webhook_events` (append-only), written **after** signature verification and **before** any grant, with a unique index on the provider event id so a redelivery is a no-op. The handler then processes inline as it does now, and stamps the row done/failed. A new cron-driven worker leases unprocessed rows (`FOR UPDATE SKIP LOCKED`, lease timestamp + attempt count, capped backoff) and reruns the same `resolveBinding → confirmAgainstBinding → callGrantRpc` path, so it can complete a purchase long after the provider gave up. Rows exhausted past the cap become an `ops_alerts` signal instead of disappearing.

### 2. Reconciliation sweep
The inbox only covers events that arrived. A second sweep walks purchase rows still `created`/`pending` past a threshold, asks Razorpay for that order's payments, and finishes any that are captured — this is what catches an event the provider never sent at all. Read-only against the provider; grants go through the same RPCs.

### 3. Refund / dispute event tracking + admin resolution
`refund.*` and `dispute.*` are currently acknowledged and dropped. They will be recorded in the inbox and projected into a `payment_disputes` view/table, surfaced as a new **Refunds & disputes** section on the existing admin screen with the existing `is_admin` gate. Resolution actions apply the **existing refund policy only** — no new policy, no price change, no provider refund call.

### 4. Failed attempt then valid captured success
`payment.failed` currently writes a terminal failure; a later genuine capture for the same order must still grant. The fail path becomes non-terminal for a row that later confirms, and the credit RPCs (already idempotent) stay the single writer. No migration to the existing state machine beyond allowing that one transition.

### 5. Concurrent / uncertain order creation
The food path reuses an open attempt; the four purchase products do not, so a double tap can mint two Razorpay orders for one intent. Add the same "reuse an open, same-amount attempt" guard to those four, keyed on the purchase row rather than the browser.

### Publish-verification gap
Publish job `18fbbbb2-…` returned `pending` and the platform exposes **no** published-commit or status field — verified earlier only by live HTTP. A small `scripts/verify-publish.ts` will assert the live host, a representative route and the entry asset, so "published" is evidenced by a repeatable command instead of a one-off check.

## Risks

- **Money path.** Everything here writes through the existing idempotent credit RPCs; no new grant logic. The riskiest edit is (4), the failed-then-captured transition.
- **The inbox must never gate the signature.** Writing the row happens after HMAC verification, or the table becomes an unauthenticated write surface.
- **Retry worker concurrency.** Must use `FOR UPDATE SKIP LOCKED` leasing — the parked payout work documents exactly what a plain `SELECT ... WHERE status='queued'` costs.
- **Deploy is explicit.** A web publish does not deploy functions; `razorpay-webhook`, `razorpay-verify` and the new worker must be deployed by name.

## Boundaries kept

No paid provider, no price or refund-policy change, no real charge/capture/refund/payout, no product activation, no RBI or compliance claim. Payouts stay gated as measured: `creator_payout_config.payouts_enabled = false`, and `RAZORPAYX_ACCOUNT_NUMBER` is unset. Backend target is the live Lovable Cloud instance, region `ap-southeast-2`, not paused. No secrets or customer records appear in any output.

## Technical notes

- New tables: `payment_webhook_events`, `payment_disputes`. Both RLS-enabled, admin `select` only, every write service-role — the `ops_alerts` shape.
- New function: `payment-reconcile` (cron-driven, service-key gate chosen **by JWT shape**, the defect the watchdog already documents).
- New cron entries alongside the existing six.
- Tests: table-driven across all five products, inbox dedup, lease contention, refund/dispute projection, failed-then-captured, concurrent creation — fictional fixtures only, plus mutation checks per mechanism.
