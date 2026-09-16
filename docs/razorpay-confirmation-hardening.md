# Razorpay confirmation hardening — 2026-09-16

Baseline: `0919fec1d6366237ec27234c258ae7911c287b6d`. Source only. **Nothing was
deployed, published, migrated, or sent to Razorpay.**

## What was wrong

Both confirmation paths granted on evidence that does not establish payment.

- `razorpay-verify` verified the checkout HMAC and immediately called a grant
  RPC. A signature proves that a party holding the key secret paired an order id
  with a payment id. It does not prove the money was captured, nor that the
  amount or currency match. An `authorized` payment — held, never taken —
  carries a perfectly valid signature.
- `razorpay-webhook` chose which ledger to credit from `notes.kind`, a string we
  wrote on the order and the event echoes back, and never checked the amount.
- Both coerced browser/event fields with `String(...)`, so an object reached a
  hash and a query string as `[object Object]`.
- The webhook answered HTTP 200 when it was not configured, turning a
  misconfiguration into a silently dropped payment.

## What it does now

New shared module `supabase/functions/_shared/razorpayConfirm.ts`, isolated from
the payout helper and making no POST to Razorpay at all.

1. **Strict shapes** — `order_…` / `pay_…` validated before hashing or being put
   in a URL; the signature must be hex.
2. **Our row decides the product** — the provider order id is looked up across
   the five purchase tables (`payments`, `story_purchases`,
   `watermark_purchases`, `plan_purchases`, `video_purchases`). Two claimants,
   or a row with a non-integer/non-positive price, refuses. The caller and the
   event never name the product.
3. **Ownership** (callback path) — the signed-in user must own that row; "not
   yours" and "not there" answer identically.
4. **HMAC over the server-stored order id** plus the caller's payment id.
5. **The provider's own record** — one bounded `GET
https://api.razorpay.com/v1/payments/:id`: fixed origin, `redirect: "manual"`,
   8 s deadline, 64 KiB body cap, no retries, nothing from the payload logged.
   Requires matching id and order, a positive safe-integer amount equal to our
   stored minor-unit price, our stored currency, `status === "captured"` **and**
   `captured === true`, no refund indicators, and no conflicting stored payment
   id.
6. **Then the existing idempotent service-role RPC**, whose HTTP status _and_
   `ok` are both checked — a 200 carrying `{"ok":false}` is a refusal.

Failure policy: configuration, database, provider and RPC failures fail closed
and stay retryable (callback 502, webhook 500). A definitive verdict is
acknowledged (webhook 200 with `ok:false, refused:<code>`) because retrying it
returns the same answer. Webhook bodies are size-bounded before the signature
check; the raw body is still hashed before anything parses it. Accepted payment
methods, pricing, providers, refund policy and failed-payment policy are
unchanged.

## Evidence

- `src/lib/__tests__/razorpayConfirmRuntime.test.ts` — 43 tests that execute the
  real deployed handlers against a mocked network, asserting **no grant RPC** on
  authorized / failed / refunded, id / order / amount / currency mismatch, wrong
  user, unauthenticated, malformed input, bad signature, unknown order,
  ambiguous binding, database failure, provider failure and semantic RPC
  refusal — plus all five products routed from our own row, notes unable to
  select another product, and duplicate deliveries.
- Controlled mutation: removing the `captured` guard turns 4 tests red
  (`authorized, never captured`, `captured flag false`, `failed`, and the
  webhook's `authorized`); restored, 43/43 pass.
- `tsgo --noEmit`, `lint:ci` on the changed path, Prettier on all four files and
  `deno check` of both functions pass; related regressions (`classicWithdrawn`,
  `phase0Gate`, `storyStageGates`, `payoutConcurrency`, `edgeImports`) pass
  71/71.

## Residual blockers (not addressed this cycle)

- **No durable event inbox** — webhook deliveries are not stored, so there is no
  reconciliation job and no replay of an event dropped during an outage.
- **Failed-to-late-success policy** — a purchase marked failed and later
  captured has no defined transition.
- **Refunds and disputes** are acknowledged and not acted on.
- **Account and product qualification** with the provider is unverified here.

None of this establishes RBI compliance, and the app remains a prototype rather
than a bank or payment service provider.
