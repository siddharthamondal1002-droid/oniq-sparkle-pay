# Payment recovery — what was executed, verbatim

Nothing in this cycle is applied, deployed or scheduled. `migration.sql` is a
file; the cron schedule is not created; the worker ships inside an existing
function and is unreachable without the service credential.

## The worker lives inside an existing function

Creating a new Edge Function is blocked on this platform, so the worker is
`supabase/functions/_shared/paymentRecoveryWorker.ts`, exporting
`handlePaymentRecovery(req, rest, headers)` — **not** a second `Deno.serve` —
and reached at exactly:

    POST /functions/v1/razorpay-webhook?mode=recovery

Two doors, one function, and neither one's authentication can be reached
through the other:

| URL                              | gate                                          |
| -------------------------------- | --------------------------------------------- |
| `?mode=recovery`                 | constant-time match against the service key    |
| no mode (the provider's own URL) | raw HMAC over the unparsed bytes               |
| any other mode                   | 400 before anything is read                    |

A provider delivery carries no service key, so it cannot select the worker; a
service key carries no signature, so it cannot skip the HMAC. Both are
executed tests, not claims.

## Executed

### Isolated PostgreSQL (throwaway cluster, discarded on exit)

    bash scripts/payment-recovery-sql-test.sh
    -> ALL SQL TESTS PASSED     24 "ok" assertions
       T11 recorded=1 duplicate=11 rows=1 errors=0   (12 simultaneous deliveries)
       T12 claimed=23 duplicated=0                   (4 simultaneous claimers)
       T13 one case, opened exactly once             (8 simultaneous events)

**One intermittent, recorded rather than re-run away.** Twice during repeated
back-to-back invocations the 12-session race reported `duplicate=10 errors=2`
and once `duplicate=7 errors=8`. In **every** such observation `rows=1` and
`recorded=1` — the atomicity property under test never broke; sessions failed
to answer at all. It has not reproduced since, including under two clusters
running at once. The cause is **unexplained**, so the assertion was left strict
and the harness now prints the sessions' own error text on failure instead of a
bare "not atomic", which could not separate a dedup fault from a session that
never connected.

### Runtime (the real handler, real routing, real validators)

    npx vitest run src/lib/__tests__/paymentRecoveryRuntime.test.ts
    -> 63 passed

    npx vitest run src/lib/__tests__/razorpayConfirmRuntime.test.ts
    -> 118 passed

    npx vitest run                     (whole suite)
    -> 423 files, 7581 passed

### Mutation — 6 of 6 RED

    bash scripts/payment-recovery-worker-mutate.sh
      baseline GREEN
      M1 the recovery door accepts any bearer        -> RED
      M2 the mode is matched by prefix               -> RED
      M3 the worker calls the dispatching tick       -> RED
      M4 a lost lease counts as done                 -> RED
      M5 reconciliation resolves a refused grant     -> RED
      M6 the stale-failure guard is removed          -> RED

**Two anchors were wrong on the first run and the script said so rather than
printing a verdict.** M1 was `NOTAPPLIED` (a stale anchor). M2 reported
`GREEN <- ESCAPED` while mutating the wrong line: it changed the branch
*selector* while the *validator* one block above still rejected the bad mode,
so the mutation never opened the hole it named — defence in depth read as a
hole in the tests. Both repointed; both RED.

### Gates

    npx tsgo --noEmit                          clean
    npm run lint:ci -- <the two test files>    clean
    npx prettier --check                       clean
    deno check --no-lock  razorpay-webhook/index.ts
                          _shared/paymentRecoveryWorker.ts
                          _shared/razorpayCaseRead.ts        clean

## The properties the tests hold, and why each one matters

- **A refused caller makes no call at all.** Nine wrong credentials — including
  a forged JWT claiming `service_role` — each return 401 with `calls === []`.
  Not "no writes": no reads, no provider traffic. A JWT is a claim anyone can
  mint; only holding the secret settles it, so the role is never decoded.
- **The mode is exact.** `recovry`, `Recovery`, `recover`, `recovery2`,
  `recovery%20` and an empty value all 400 before anything is read.
- **The probe is authenticated and does nothing.** It answers `configured`
  without one table read, so the cron's credential can be checked before the
  schedule is enabled, and a probe that needed the work's privileges would be
  testing something else.
- **The worker never calls the dispatching tick.** The tick POSTs this worker;
  a worker that called it would summon another, unbounded. It calls
  `payment_recovery_maintain` instead — the tick was split for exactly this.
- **A lost lease is a refusal.** `{ok:false}` from a completion RPC counts
  `leaseLost`, never `done`.
- **A stale failure cannot downgrade a settled purchase.** A late
  `payment.failed` against a row carrying a payment id, or a paid/captured/
  refunded status, is `ignored` — not retried, because deliveries are unordered
  and there is nothing to come back for.
- **Cases are read fresh from the provider and carry the case's own amount.** A
  ₹1 refund of a ₹49 payment is filed as ₹1; taking the payment's amount would
  turn a partial refund into a total one. A case whose payment, currency or
  amount does not belong to the order is refused, not filed.
- **Reconciliation never relabels itself.** It grants with
  `_confirmed_by: "reconcile"`. `mark_order_paid` currently rejects that value
  for **every** food row, so a food reconciliation stays a visible retry that
  exhausts into a manual case. It is never resolved, and never re-sent as
  `"webhook"` to slip past the constraint — a test asserts the absence.
- **Nothing here writes to the provider.** Across every path exercised, every
  `api.razorpay.com` request is a GET and none names a money-moving verb.
- **The bounds are real.** A 400 KB provider body is refused mid-stream rather
  than buffered; an oversized or non-JSON request body 400s before any call;
  batches, lease seconds and the whole-worker deadline are finite and asserted.

## Still not done

- The migration is **unapplied**. The cron schedule is **not created**;
  `setup_schedule` exists and is not called by the file.
- **No deploy.** Until one happens the recovery mode does not exist in
  production, and the authenticated probe cannot be run against it.
- The order in which that must happen: review → deploy → authenticated probe
  returns `ok` → only then enable the schedule.
- **Nothing has processed a real event.** Every result above is an executed
  test against the committed code, not a production observation.
