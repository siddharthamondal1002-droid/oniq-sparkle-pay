# Razorpay confirmation hardening

Source only. **Nothing here was deployed, published, migrated, or sent to
Razorpay**, and no payout path was touched. These are newly committed SOURCE
handlers: the code described below has not been deployed, so nothing in this
document is a statement about what is currently running in production.

Scope note on the product: ONIQ itself is an existing published application.
The separate APP reference package this work was reviewed against is a
prototype. Neither fact makes ONIQ a bank or a payment service provider, and
**nothing here establishes RBI compliance or any other regulatory status.**

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

## Found in review of the first pass, and fixed here

1. **Body limits were enforced after buffering.** `arrayBuffer()` reads the
   whole body and only then reports its size, so a chunked request with no
   `content-length` was unbounded in practice. Reads are now bounded WHILE
   streaming: a declared length over the ceiling is refused before a byte is
   read, the running total is checked per chunk, the stream is cancelled on
   overflow, and a stalled read has its own deadline. Decoding is `fatal`
   (malformed bytes refuse rather than becoming U+FFFD) with `ignoreBOM: true`
   (a BOM is preserved), so the string the webhook HMAC is computed over is byte
   for byte what arrived. A stall and a mid-read reset are reported as different
   codes rather than collapsing into one. **Cancellation is initiated and never
   awaited**: `cancel()` settles only when the underlying source agrees, so
   awaiting it would let a source that never agrees hold the refusal open for
   exactly as long as the body being refused — the bound would be decorative.
   The discarded promise's rejection is still handled. A test drives both
   refusal paths with a `cancel()` that never settles and asserts the refusal
   still returns.
2. **Malformed provider fields became benign defaults.** A missing or
   non-numeric `amount_refunded` read as `0` and an unreadable `refund_status`
   as `null` — inventing the evidence that a payment was not refunded out of the
   fact that it could not be read. Every field is now required and typed:
   `entity` must be exactly `"payment"` (a body that is not a payment entity is
   not a payment, however many payment-shaped fields it carries);
   `amount_refunded` must be a non-negative safe integer no greater than
   `amount`; `refund_status` must be PRESENT and exactly JSON `null`,
   `"partial"` or `"full"` — an absent field is a refund state nobody read, and
   the string `"null"` is what a serialiser emits once it has lost the
   difference between a null and the word; `captured` must be a boolean;
   `amount` a positive safe integer; `currency` three letters; both ids
   well-formed. A null or array provider root is rejected rather than read as an
   object.

3. **The webhook acknowledged events it had not processed.** With **no durable
   event inbox and no quarantine table**, a 2xx is final: the event is gone. The
   previous version acknowledged provider 401/403/404, redirects, not-yet
   captured payments, unknown or ambiguous bindings, missing payment ids, and
   semantic grant refusals — every one of which can be a credential fault, a
   database race, eventual consistency, or an unresolved paid purchase. A
   handled event now receives a 2xx **only when it was successfully processed**;
   otherwise it gets a retryable `503` and grants nothing. Event types the
   function does not handle at all (refunds, settlements, disputes) are still
   acknowledged. The claim that `payment.captured` always follows `order.paid`
   has been removed — it is not guaranteed, so an `order.paid` without a payment
   entity is retried rather than written off.
4. **Failure RPC contracts differ, and the code assumed one.** Read from the
   live catalogue: `fail_watermark_purchase` is declared `returns void`, so
   success is HTTP 200 with a null or empty body, while `fail_story_purchase`,
   `fail_plan_purchase`, `fail_video_purchase` and `mark_payment_failed` return
   `jsonb` `{ok:true}`. The old helper demanded `{ok:true}` from all of them,
   which made every successful watermark failure look broken; and the
   `payment.failed` path ignored a semantic `ok:false` from the others and
   reported success. The expected shape is now carried per product, and any
   failure-RPC result that is not a success produces a non-2xx. **No state
   transition and no migration was changed.**
5. **The binding was partly taken from the caller.** `resolveBinding` did not
   select `provider_order_id`, so the id used for the HMAC, the provider
   comparison and the RPC argument was the caller's string. It now selects and
   re-validates the stored id and requires `provider = 'razorpay'`; a non-array
   database response is a fault rather than "no rows"; a non-null but malformed
   stored payment id refuses instead of reading as "never settled"; two rows in
   one table refuse as ambiguous. The callback used to resolve the binding
   twice — once for ownership and again inside the confirmation helper — and
   then grant against the first. There is now **one** resolution, used for
   ownership, the HMAC, the provider check and the RPC routing.
6. **Assorted strictness.** Both JSON roots must be plain non-null,
   non-array objects. Signatures must be exactly 64 hex characters (HMAC-SHA256
   is that long; a 40–128 range admitted nothing useful). A callback with
   missing configuration answers non-2xx while keeping the existing
   `configured: false` payload the client already reads. Caught errors are no
   longer logged as values — only our own code strings are — because the caught
   value can carry request fragments from a body that may not even be verified.

## What it does now

Shared module `supabase/functions/_shared/razorpayConfirm.ts`, isolated from the
payout helper and making no POST to Razorpay at all.

1. **Strict shapes** — `order_…` / `pay_…` validated before hashing or being put
   in a URL; the signature must be 64 hex characters.
2. **Our row decides the product** — the provider order id is looked up across
   the five purchase tables (`payments`, `story_purchases`,
   `watermark_purchases`, `plan_purchases`, `video_purchases`) exactly once. Two
   claimants, a stored id that disagrees, a different provider, or a
   non-integer/non-positive price all refuse. The caller and the event never
   name the product.
3. **Ownership** (callback path) — the signed-in user must own that row; "not
   yours" and "not there" answer identically.
4. **HMAC over the server-stored order id** plus the caller's payment id.
5. **The provider's own record** — one bounded `GET
https://api.razorpay.com/v1/payments/:id`: fixed origin, `redirect: "manual"`,
   8 s deadline, 64 KiB streamed body cap, no retries, nothing from the payload
   logged. Requires matching id and order, a positive safe-integer amount equal
   to our stored minor-unit price, our stored currency, `status === "captured"`
   **and** `captured === true`, well-formed refund fields showing no refund, and
   no conflicting stored payment id.
6. **Then the existing idempotent service-role RPC**, whose HTTP status _and_
   declared result contract are both checked — a 200 carrying `{"ok":false}` is
   a refusal, and a void RPC's empty body is a success.

Failure policy: configuration, database, provider and RPC failures fail closed.
The callback answers 502 (retryable) or 400/404 (settled), and never reports
success on a refusal. The webhook returns 503 for any handled event it did not
process. Webhook bodies are size-bounded while streaming, before the signature
check; the raw body is still hashed before anything parses it. Accepted payment
methods, pricing, providers, refund policy and failed-payment policy are
unchanged.

## Evidence

`docs/razorpay-confirmation-evidence.txt` holds the raw stdout/stderr of the
commands below. All fixtures are fictional; the only key material anywhere is a
made-up string in the test file.

- `src/lib/__tests__/razorpayConfirmRuntime.test.ts` — tests that execute the
  committed handler bodies against a mocked network. They assert **no grant and
  no reported success** on: authorized / failed / refunded / partially refunded,
  id / order / amount / currency mismatch, malformed refund amounts (numeric
  string, negative, fractional, larger than the payment, absent), unrecognised
  refund status, non-boolean `captured`, malformed provider roots, provider
  401/403/404/429/500, provider redirects, provider unreachable, corrupt
  bindings (wrong stored order id, wrong provider, bad stored payment id, bad
  price, bad currency, missing owner), malformed database responses, duplicate
  rows, wrong user, unauthenticated, malformed input, bad and wrong-length
  signatures, non-object JSON roots, unknown order, ambiguous binding,
  configuration absent, and semantic RPC refusal — plus all five products routed
  from our own row on both the credit and the failure path, the void failure
  contract, duplicate deliveries, a single binding resolution, and the streaming
  limits (oversized chunked body with no `content-length` and its cancellation,
  declared-length refusal without reading, a `cancel()` that never settles on
  both refusal paths, stalled reads, mid-read resets, BOM preservation,
  malformed-byte refusal, multi-byte characters split across chunks), plus a
  missing/wrong/non-string `entity` and a missing or string-`"null"`
  `refund_status`.

- A test that reaches an RPC and asserts no SUCCESS is asserting exactly that. A
  semantic refusal is only observable by calling the RPC, so those cases do not
  claim "no RPC call".
- Controlled mutation of the `captured` guard, re-run after restoring it.
- `tsgo --noEmit`, `lint:ci` on the changed paths, Prettier, and `deno check` of
  both functions.

## Residual blockers (not addressed)

- **No durable event inbox** — deliveries are still not stored. The 503 policy
  above leans entirely on Razorpay's own retry schedule; an event that exhausts
  it is still lost, and there is no reconciliation job and no replay.
- **Failed-to-late-success is inconsistent by product, not undefined.** Read
  from the live catalogue: `mark_order_paid` refuses any status other than
  `created` or `paid`, so a purchase marked failed cannot later be credited,
  while `credit_story_purchase`, `credit_plan_purchase`, `credit_video_purchase`
  and `settle_watermark_purchase` only short-circuit on `paid` and will credit a
  row previously marked failed. That difference is a product decision, not an
  engineering one, and was not changed here.
- **Refunds and disputes** are acknowledged and not acted on.
- **Account and product qualification** with the provider is unverified here.
- **Nothing is deployed**, so none of this is in effect for any user.
