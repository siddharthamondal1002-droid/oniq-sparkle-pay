# ONIQ Task Roadmap

- [x] Fix preview build errors in `supabase/functions/story-still/index.ts` (`sleep` return type)
- [x] Make the checkpoint refusal deterministic so a failing frame is submitted once, not three times
- [x] Put the in-house still stage inside the spend ledger (reserve before dispatch, settle both terminal outcomes)
- [ ] BLOCKED: repair the worker's checkpoint refusal. `oniq-gpu-worker` answers 404 to the credential this
      project holds (Git and the repository API), so the worker source, its image publication workflow and
      its endpoint template cannot be reached from here. Nothing about the five ltxcaps refusals can be
      diagnosed or fixed without it.
- [ ] BLOCKED on the above: the one-PNG-to-one-clip proof (bytes, storage key, GPU job, aliveness, settled
      ledger). Held deliberately — a diagnostic attempt now would meet the same baked image and refuse again.

## 2026-09-13 health report

- [x] Item 2 (partial): `send-push` now distinguishes provider ACCEPTANCE from handset delivery, and
      `push.ts` records a sanitized reason breakdown instead of a silent success. A failed member or
      token SELECT is now a 500 rather than `noRecipients`/`unaddressed` — our fault must not be
      reported as the recipient's. Reason codes are a closed allowlist folded to `other`; no token,
      endpoint or provider body is ever counted. See `src/lib/__tests__/sendPushDiscriminator.test.ts`.
- [x] Item 2 (partial): the video share path no longer claims a save it cannot observe. A refused
      `navigator.share` REQUESTS a download and returns `download-started`; the stage is
      `web-share-refused-download-requested`, not the earlier `web-activation-lost`, which asserted a
      cause (lost transient activation) that a Permissions-Policy or user-agent denial produces
      identically. The file-capability probe now runs BEFORE the fetch, so a browser that cannot share
      files no longer downloads megabytes first. The fetch-before-share order itself is NOT fixed and
      cannot be from inside `share.ts`: a File is required before `share()` and any await ends the
      activation window — the remedy is a second explicit tap at the call site.
      `src/lib/__tests__/shareActivationFallback.test.ts` keeps cancellation a non-error.
- [x] Item 6: measured, and the answer is NO overload. `pg_stat_statements.stats_reset` is NULL —
      which means the view has never been reset, so the 166 GiB is a cumulative total over an
      UNKNOWN window (it is not a statement about a recent spike, and no rate can be derived from
      it). A `pg_stat_statements` snapshot is also bounded by `pg_stat_statements.max`, so
      evicted statements are absent from that total altogether. In the live counters the only temp
      writers are introspection/tooling queries totalling ~4 MiB; every application query writes
      ZERO temp blocks. No index or memory change is warranted — do not add one on the strength of
      the cumulative figure.

- [x] Item 1 RESOLVED. The blocker was the installer, not the advisories, and the route around it is
      npm 11 with a lock-only, date-bounded update — no `package.json` edit and no overrides:
      `npx npm@11.9.0 update dompurify hono fast-uri js-yaml postcss qs nanoid browserslist
brace-expansion @xmldom/xmldom vitest --package-lock-only --ignore-scripts --no-audit
--no-fund --before=2026-09-12T00:00:00Z --registry=https://registry.npmjs.org`.
      The container's own npm (10.9.4) still crashes with
      `TypeError: Cannot read properties of null (reading 'edgesOut')` in arborist's peer-set walk —
      that crash is an npm-10 fault, pre-existing, and npm 11 does not reproduce it.
      `--before` is what keeps `baseline-browser-mapping` at 2.11.22 instead of the under-24h 2.11.23
      the release-age guard refuses, so the guard is preserved rather than bypassed.
      Locked now: @xmldom/xmldom 0.9.12, brace-expansion 5.0.9, browserslist 4.28.9,
      baseline-browser-mapping 2.11.22, dompurify 3.4.15, fast-uri 4.1.4, hono 4.13.7, js-yaml 4.3.2,
      nanoid 3.3.19, postcss 8.5.28, qs 6.16.0, vitest 4.1.11.
      `npm audit --registry=https://registry.npmjs.org`: **0 high, 3 moderate, 1 low, 4 total** (was 17).
      Residual by choice, NOT erased with a downgrade: @capacitor/cli -> xcode -> uuid 7.0.3
      (GHSA-w5hq-g745-h8pq; npm's only fix is an out-of-range @capacitor/cli 8.4.3) and
      @lovable.dev/mcp-js -> esbuild 0.27.7 (GHSA-g7r4-m6w7-qqqr, Windows dev-server file read).
      `bun.lock` was badly stale against it (vitest 4.1.10, dompurify 3.4.12, postcss 8.5.15,
      baseline-browser-mapping 2.10.21). Migrated the TESTED npm graph rather than running a blanket
      bun update: a temp directory holding only `package.json`, the updated `package-lock.json` and
      the unchanged `bunfig.toml` (no `bun.lock`), then `bun install --lockfile-only
--ignore-scripts` (bun 1.3.3), and the generated `bun.lock` copied back. Frozen lock-only
      re-run is idempotent. Package-version set diff against the npm lock is only the `h3-v2` alias
      and two optional WASM packages, exactly as measured externally.
      Gates in this environment, all green: clean `npm ci` in a scratch directory (765 packages),
      `check:deps` 104/104, `npx vitest run` **403 files / 7228 tests passed** (no EPERM here — the
      6 sandbox-blocked tests reported externally do run), `tsc --noEmit` 0, `lint:ci`,
      `format:check:changed`, and a full `npm run build`.
- [x] Security finding AGE_SELF_ATTESTATION fixed (migration
      `profiles_private_dob_immutable_by_client`). `profiles_private` had table-wide INSERT/UPDATE
      for `authenticated` — a later migration had widened the original 20260729162218 design, which
      granted `(upi_vpa, updated_at)` only — so a client could PATCH its own `date_of_birth` and skip
      the whole age flow: `is_adult_18()` and every minor gate read that column. Column grants are
      restored to `(user_id, upi_vpa, updated_at)` for INSERT and UPDATE; `service_role` unchanged.
      Verified live with `has_column_privilege`: `date_of_birth`, `is_minor` and `parent_*` are now
      false for INSERT and UPDATE, `upi_vpa` still true. Age can therefore only be set through
      `set_signup_profile()` (SECURITY DEFINER, so grants do not apply to it), which keeps the
      3-edits-per-7-days limit, the `child_mode_locked` refusal, `dob_change_events` and the audit
      rows; `trg_prevent_is_minor_self_change` remains as the second guard. The UPI-ID upsert
      (`{ user_id, upi_vpa }`) is unaffected.

- [ ] Item 3 BLOCKED at the credential, with the target now named precisely: the writer is
      `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` and the bucket is the hard-coded `STILL_BUCKET`
      = `oniq-gpu` (`_shared/stillStore.ts:65`). `r2-probe` is the existing narrow write/read/delete
      check and it is service-role only; this SQL role is denied `ops_watch_pick_key()`, so no
      service-role credential can be minted from here to invoke it. The missing authorization to
      state to Cloudflare is: the R2 API token behind those two secrets needs Object Read & Write on
      bucket `oniq-gpu` (it demonstrably has it on `oniq-chat-media`). No broader or public grant.
- [x] Item 4 APPLIED (migration only — nothing deployed). `provider_spend_ledger` is the DOLLAR
      guard and has no currency column, so a gateway call billed in CREDITS could not be booked
      there without inventing a rate or charging a direct-provider ceiling with money that never
      touches it. Both are forbidden, so credits get their own relation:
      `20260913120000_gateway_credit_ledger.sql` adds `gateway_spend_ledger` (unique `request_id`,
      `currency='CREDITS'`, nullable `charged_credits`, `provider_receipt_id`, settlement state
      PENDING_RECONCILIATION | SETTLED | NOT_CALLED | FAILED) plus `capture_gateway_spend` /
      `settle_gateway_spend`, executable by `service_role` only; a person may read their own rows.
      `_shared/gatewayLedger.ts` is the seam — capture before the call, settle on every exit
      INCLUDING the throwing one (an ambiguous failure settles FAILED, never NOT_CALLED, because a
      timeout says nothing about whether the gateway served the request). An undisclosed price stays
      NULL and PENDING_RECONCILIATION; 0 is reserved for a call that was genuinely free. Wired into
      the gateway TEXT engine (`llm.ts`) and the gateway IMAGE engine (`gatewayImage.ts`); the rpc is
      an argument with no default, so a caller without database reach records nothing and says so.
      NO historical rows were fabricated. `src/lib/__tests__/gatewayCreditLedger.test.ts` asserts the
      module names no USD concept at all.
- [x] Item 1 CLOSED — THE HOOKS HAVE REAL CALLERS NOW. The previous pass changed only the two
      seams and left every production call site passing nothing, so the accounting was reported as
      done while recording not one row. That is this repository's most-recorded failure, and
      `src/lib/__tests__/gatewayRealCallers.test.ts` exists so it cannot recur silently: both
      `story-still` draws, the `story-plot` IR rescue and the INLINE `story-voice` TTS path each
      pass a binding built from `serviceRoleRpc()` and server-derived identity — `auth.jobId` and
      `caller.userId`, never a body field. Every provider ATTEMPT mints its own
      `crypto.randomUUID()`, so a redraw and a rescue's repair pass are distinct rows rather than a
      charge that vanishes into a duplicate. `gatewayVoice.ts` is deliberately NOT the caller: it
      is an orphan module, and story-voice's live TTS call is inline.
- [x] Item 2 CLOSED: a 402 or 429 REACHED the gateway, so it settles REJECTED with an unknown
      charge, never NOT_CALLED. "No receipt" is not a proof of no charge. NOT_CALLED is now
      reserved for a LOCAL preflight refusal, and an image preflight failure captures nothing at
      all rather than booking an attempt that was never made.
- [x] Item 3 CLOSED: `withGatewayCostCapture` reads its capture result and `settleGatewaySpend`
      returns a bounded `SettleResult` instead of swallowing the RPC error — a missed row is now
      visible without changing whether the generation itself is served. `ledger.detail` carries an
      allowlisted phase plus a numeric status and never a raw exception message; the provider's own
      request id is preserved from the verified body or headers even when the charge is unknown,
      and no receipt field is invented.
- [x] Item 5 CLOSED: the share flow is fixed at the product call site, not declared unfixable.
      `YourVideos` prepares the File on the first tap (`saved-share-prepare`) and the next tap
      (`saved-share-send-now`) calls `navigator.share` synchronously with nothing awaited in front
      of it, so the transient activation survives. No effect auto-shares. A cancel is a cancel and
      never becomes a download; a genuine platform refusal still offers the bytes and claims only
      `download-started`, which is all a programmatic click can honestly prove.
- [ ] Item 4 REMAINING: nothing reconciles a PENDING row — the gateway discloses no price at call
      time, so every row booked today stays PENDING until a receipt source exists. Nothing here is
      deployed.
- [ ] Item 5 (infrastructure): production is `bqwttemnnoexadpwifcj` (corroborated at runtime — it
      serves the 127 profiles and run #171). `nzbthoecadcwdoqxhaok` is NOT production. CORRECTION
      to the earlier "repo 404": the worker repository is reachable after all —
      `siddharthamondal1002-droid/oniq-gpu-worker` is PUBLIC and its source, CI run and
      image-publish run are readable through the GitHub API; the 404 was this container's Git
      transport, not the repository's visibility, and reading one as the other is what stalled the
      checkpoint diagnosis. SOURCE/READ ACCESS IS NOT LIVE IMAGE IDENTITY: which image DIGEST the
      live RunPod endpoint is running is an ENDPOINT fact, still unknown from here, and so is the
      character-motion bucket authorization.

## Two test defects this pass exposed, both in the tests rather than the code

- **A COMMENT CONTAINING `/*` ATE 80% OF A FILE UNDER TEST.** `gatewayRealCallers.test.ts` stripped
  block comments BEFORE line comments, and `story-voice/index.ts` carries
  `// ... for google/*-tts the ...` — a false block opener that swallowed the rest of the file, so
  three assertions failed against perfectly correct source. Line comments come off first now. The
  shared `src/test/sourceText.ts` has the same hazard by construction and was NOT changed here: it
  is used by dozens of guards and widening its scope is its own change.
- **`vitest.config.ts` sets `environment: "node"`,** so there is no DOM. The new share test stubs
  `navigator`, `document` and `URL` outright, the way `shareActivationFallback.test.ts` does, and
  counts the fallback CLICK rather than a return value — the fallback could otherwise report a
  download without handing the bytes over, which is the exact claim the two-step split exists to
  stop making.

## Gates, this pass

Measured at `45a2a78c` with a clean tree. `tsc --noEmit` 0 errors · `npm run lint:ci` clean ·
Prettier clean on every changed file · `npx vitest run` **405 files / 7,248 tests, ALL PASSING** ·
`npm run build` succeeded. The focused four — `gatewayRealCallers`, `shareTwoStep`,
`gatewayCreditLedger`, `shareActivationFallback` — are 40/40.

One earlier run of the same tree failed `arapStep11dDiagnosis` and the clean run above is the
reason that is recorded as a FLAKE rather than a result: the file passes on its own (measured), and
CLAUDE.md carries it as a known timing wobble under load. **A failure that does not reproduce on an
unchanged tree is unmeasured, not fixed** — it is not claimed as either.

## Ledger SQL, read back from production rather than asserted

The replay and receipt rules are LIVE on `gateway_spend_ledger`, read from `pg_constraint` and
`pg_indexes` this pass:

    gateway_spend_receipt_identity_idx   UNIQUE (provider, provider_receipt_id)
                                         WHERE provider_receipt_id IS NOT NULL
    gateway_spend_ledger_request_id_key  UNIQUE (request_id)
    gateway_spend_not_called_is_free     outcome NOT_CALLED ⇒ charged_credits = 0
    gateway_spend_settled_has_price      SETTLED ⇒ charged_credits IS NOT NULL
    gateway_spend_values_are_finite      no NaN in charged_credits or units_observed
    charged_credits / units_observed     NULL or >= 0 · currency pinned to CREDITS
    settlement_state                     PENDING_RECONCILIATION | SETTLED | NOT_CALLED | FAILED

The receipt index is PARTIAL on purpose: a row with no receipt yet is not an identity claim, so
many PENDING rows coexist while two billable attempts can never claim one receipt. `user_id` is
`ON DELETE SET NULL`, so an erased account leaves the ledger honest rather than deleting a charge.

## Spend

- Lovable agent credits, read from message metadata and not estimated: dependency turn **5.8**,
  initial repair **13.9**, review **18.7**, this task **20.2**. No blanket "nothing was charged"
  claim is made.
- No Google, OpenAI, GPU or R2 spend: nothing was deployed, published, rendered or generated.

## 2026-09-13 story patch set

- [x] Non-motion Story repairs: movie-grade `story-plot` now receives `screenSeconds`, carries film continuity guidance through the direct planner and Story IR rescue, and the worker separates visible-scene ambience from shot emotion with `sceneAmbienceFor` / `soundEmotionFor` so non-motion shots keep continuity without narration-only sound drift.
- [x] Foreground responsiveness: Story polling now pauses while the app is hidden through `startVisiblePolling`, and Ting refuses overlapping asks with an `askInFlight` lock while preserving the newly appended user turn if the function reports `configured: false`.

## 2026-09-13 — the five review defects, measured

The line above ("no NaN in charged_credits or units_observed") was WRONG and the review is what
caught it. `x = x` does not reject NaN in Postgres: numeric NaN compares EQUAL to itself and sorts
ABOVE every finite value, so the old constraint admitted `'NaN'::numeric` and both infinities.
Measured on production with real SQL, not JS equivalents:

    'NaN'::numeric = 'NaN'::numeric                    true    <- the old check passed it
    'NaN'      > '-Infinity' and < 'Infinity'          false   <- the new one refuses it
    'Infinity' > '-Infinity' and < 'Infinity'          false
    '-Infinity' > '-Infinity'                          false
    1.5        > '-Infinity' and < 'Infinity'          true

Migration `20260913120000` (applied, read back from `pg_constraint`) replaces the finiteness check
with the ordering form and rewrites both RPCs:

- **`capture_gateway_spend` now compares the immutable context.** It previously returned
  `ok: true, duplicate: true` for ANY existing row, so re-using a request id under a different
  model, capability, unit, job, user or attempt was silently absorbed into the first record and the
  second charge vanished. A mismatch is refused as `context-conflict`. Concurrency-safe: the row is
  taken `FOR UPDATE`, and the lost-insert race re-reads under the same lock before comparing.
- **`settle_gateway_spend`'s `_x <> _x` NaN guard** is replaced by the same ordering form.

### The runtime verification the source scan could not give

`gatewayRealCallers.test.ts` greps call sites — it cannot see whether a row is written, whether a
retry mints a second id, or whether a failure settles at all. `gatewayRuntimeCallers.test.ts`
EXECUTES the three production paths against a mocked network: `globalThis.Deno` is given an
`env.get` over a fixture map and a `serve` that keeps the handler instead of listening, and `fetch`
is replaced. No production logic is stubbed and no gate is bypassed — auth, validation, capture and
settlement are the deployed lines, run. 9 tests, all green:

    image    capture before the draw · ACCEPTED with units 1 and the gateway's receipt · no price
             429 settles FAILED and KEEPS the receipt · a local refusal writes NO row
    text     two invocations of the rescue transport ⇒ two DISTINCT request ids, attempts 1 and 2
             402 settles REJECTED with a null charge
    voice    TTS captured in characters · ACCEPTED with the receipt · 429 keeps the receipt
             a body read that throws after a 200 settles FAILED phase body-read
             a validation refusal writes NO row

Mutation-checked: removing `receiptOf(e)` from the ledger's failure settle turns the run RED
(1 failed / 8 passed), restored green.

### Receipts on the failure paths

A refused or errored request REACHED the provider, and the id it set on that response is the only
handle a reconciliation has on a charge it may have taken. Reading it only on success leaves
exactly the charges that need tracing untraceable. Fixed in three places: `withGatewayCostCapture`
settles with `receiptOf(e)`, `gatewayImage` hangs the response's receipt on the error alongside the
status, and `story-voice` reads it on both the 401/403 and the non-2xx settle. `story-voice`'s body
read is now wrapped — a truncated stream aborting `arrayBuffer()` after a 200 previously left the
row PENDING for ever with no outcome.

`shareTwoStep.test.ts` needed no change: 8/8 green under the existing test-DOM conventions.

### Gates at this commit

    npx tsc --noEmit          0 errors
    npm run lint:ci           pass
    prettier --write          the four changed files
    npx vitest run            406 files / 7,257 — 3 timeouts under load
                              (arapStep11dDiagnosis x2, edgeImports), all three
                              PASS on their own: 2 files / 9 tests green
    npm run build             pass

Nothing deployed, published, generated or spent. `story-voice`, `story-still` and `story-plot`
carry undeployed edge-function changes; they need one deploy message after review.

## Share is bound to a film, not to a surface (2026-09-13)

`ReadyShare` carried only a SURFACE name, so preparing one saved film turned EVERY saved row's
button into "Send now" and tapping any of them sent the first film; the main film button checked
`ready` truthiness alone, so opening another film could send the previous one. Three faults sat in
the same place: a slow fetch landing after the person moved on armed the older file, a closed or
deleted film left an armed button pointing at bytes that were gone, and two fast taps both reached
the sheet.

A prepared file now carries `{kind, id}` and only that row may send it. The armed file, the
stale-fetch ticket and the one-send-at-a-time guard moved into `src/components/stories/
shareBinding.ts`, so the screen keeps no second copy — **this repo's vitest environment is "node"
with no DOM and no renderer**, and putting the decisions in a module is what makes them executable
rather than readable. `sendNow` is still synchronous with nothing awaited before the sheet.

    shareBinding.test.ts        8 runtime tests through the real module:
                                prepare A then B (A resolving LAST) arms B only,
                                B's button refuses A and sends nothing,
                                a second tap sends nothing extra,
                                an armed file drops when its film closes/leaves
    shareBindingWiring.test.ts  5 structural, comments stripped: no `ready.surface ===`
                                decision survives, each button passes its own id

MUTATIONS, 4, every one RED: the stale-fetch check removed; the source+send guard removed; the
saved row back to `ready?.surface === "share-saved-video"` (the shipped bug, verbatim); the
invalidation removed.

`src/lib/share.ts`'s comments claimed "any await ends the activation window". Corrected: transient
activation expires on a TIMER, so an await may or may not spend it — which is why the refusal is
intermittent, and why the two-step split is the remedy rather than a proof of cause.

    npx tsc --noEmit   0 errors
    npm run lint:ci    pass (changed files)
    prettier --write   the changed files
    npx vitest run     408 files / 7,270 passed
    npm run build      pass

Nothing deployed, published, generated or spent. Web-only — no migration and no edge function.

## 2026-09-13 — shareBinding invalidate() closed the pending-prepare hole (review of 4706049)

The one reproducible defect left in the two-step share: `invalidate()` checked only
`snapshot.ready`, which is null while the download is in flight, so switching away from or
deleting a film DURING its first prepare did nothing — and the stale completion then armed
the old file. The existing tests covered a second prepare superseding the first, not
selection/deletion during the first.

Fix (owner's narrow patch, applied verbatim): the binding tracks `pendingSource`; `invalidate()`
now consults `pendingSource ?? ready?.source`, and a dead source bumps the ticket so the
in-flight prepare resolves as `{outcome: null}` and arms nothing. Two new runtime tests
("discards a pending film/saved when its source disappears") fail without the fix, pass with it.

    focused   7 files / 64 tests (shareBinding, shareBindingWiring, shareTwoStep,
              shareActivationFallback, gatewayRealCallers, gatewayRuntimeCallers,
              gatewayCreditLedger)
    tsc --noEmit 0 errors; lint:ci (changed files) pass; prettier pass
    full suite 408 files / 7,271 passed, 1 failed = arapStep11dDiagnosis timing flake
              under load — passes alone (6/6), unchanged from prior runs
    npm run build pass

No deployment, publish, paid generation or GPU spend. Awaits owner review.

### 2026-09-13 — three release defects: the Ting crisis lock, the poll helper, the Story watcher

**1. A LOCK RELEASED IN THE WRONG `finally`.** `ask()` set `askInFlight.current = true`
at the top and released it in the NETWORK leg's `finally` — but crisis routing
`return`s before that leg is ever entered. So the first crisis message in a tab
locked Ting permanently: no error, no spinner, every later send silently dropped by
the guard. The release now wraps the WHOLE handler, and the not-configured early
return is covered by the same change. `src/lib/__tests__/tingRequestRuntime.test.ts`
executes the ACTUAL route handler (extracted by AST, transpiled, run with its UI and
network dependencies replaced) rather than reading its source; the crisis test was
MEASURED RED before the fix (`expected true to be false`) and green after.

**2. `Promise.resolve(tick())` CANNOT CATCH A SYNCHRONOUS THROW.** The interval helper
evaluated `tick()` outside any try, so a task throwing before its first await escaped
as an unhandled rejection and the interval kept firing on top of it. Replaced with the
completion-scheduled `setTimeout` shape: the next read is scheduled only after the
previous one finishes, so a slow read cannot be overlapped by a timer OR by a
foreground event, `await task()` returning `false` stops the poller, and cleanup during
an in-flight read prevents any later scheduling. Task type widened to accept a
synchronous `void | boolean`.

**3. THE STORY WATCHER UNLOCKED A REQUEST IT DID NOT OWN.** The effect depended on
`[jobId, jobStatus]`, so every intermediate transition tore the poller down and started
a fresh immediate read; and its cleanup reset the shared `watchingJob` ref, so a slow
request's teardown released the lock a NEWER request was holding. The ref is gone (it
was used nowhere else) and the effect keys on a derived boolean,
`isWatchingJob = !!jobId && !(jobStatus && SETTLED.has(jobStatus))`, with a local
`cancelled` flag and a `tick` that returns `!SETTLED.has(row.status)`. Failed-job quota
reporting is unchanged.

    focused   tingRequestRuntime 3, tingRequestLock 2, visiblePollingRuntime 5,
              visiblePolling 6, plus filmNonMotion / soundStage / shotDirector /
              shareBinding / shareBindingWiring — 69 tests, all pass
    tsc --noEmit 0 errors; lint:ci (changed files) pass; prettier (changed files) pass
    npm run build pass

**No live runtime proof is claimed**: the crisis lock, the poll cadence and the watcher
are proven by executing the real handler and the real helper under fake timers, not by a
session on a handset. Nothing deployed, nothing published, no edge function redeployed
(these are client-side files), no paid generation, no GPU or provider spend, 0 credits.

## Payment operations recovery — open tasks (2026-09-17)

Cycle 1 is code + isolated SQL tests only. NOTHING is applied, deployed or
scheduled, and no charge, refund or payout is ever issued.

- [x] pure module `paymentRecovery.ts` + executed module tests
- [x] reviewable SQL `docs/payment-recovery/migration.sql` + executed tests in a
      throwaway PostgreSQL cluster (multi-session concurrency, ACL, fairness)
- [x] R1 `pickCapturedPayment` must reuse `parsePaymentEntity` + `evidenceMatches`
      rather than a second, weaker parser; reject a storedPaymentId conflict
- [x] R2 `extractEventFacts` must NOT fall back to the payment's amount/status for a
      refund/dispute fact — unknown stays unknown
- [x] R3 durable provider event-id ALIAS mapping: crossed id/body pairs must quarantine,
      and a headerless body adopted under a second id must stay detectable
- [x] R4 reconcile reaper (fenced exhaustion + case + alert); the tick must CALL the
      bounded aged backfill
- [x] R5 case linkage must refuse a differing non-null binding; same-rank conflict limited
      to terminal events; case rows carry currency and a verified provider status
- [x] R6 harness: unique private temp dir, own cleanup, no repurposed HOME
- [ ] next cycle (separate, DB): mark_order_paid failed->captured, mark_payment_failed
      refunded downgrade, settle_watermark_purchase applied-on-failed-grant,
      grant_subscription first-grant race, stored-payment-id conflict checks in all five
      grant RPCs, no regrant from refunded

### Worker + webhook wiring (2026-09-17, in progress)

Routing decision, owner-directed: the worker FOLDS INTO the existing
`razorpay-webhook` function behind an explicit `?mode=recovery`. The platform
refuses to create new edge functions in this project, and a TanStack route was
declined.

- [x] `_shared/paymentRecoveryWorker.ts` exporting `handlePaymentRecovery(req)`
      — no second `Deno.serve`
- [x] `_shared/razorpayCaseRead.ts` — provider CURRENT-state refund/dispute reads
- [x] `razorpay-webhook`: durable inbox persistence before any 2xx; exact
      `?mode=recovery` branch gated by constant-time service-credential match
- [x] bounded fetch threaded through `resolveBinding` / `callGrantRpc` / every
      provider call so the total worker deadline is real
- [x] executed entrypoint tests (both URL modes) + raw evidence in
      `docs/payment-recovery/EVIDENCE.md` — 63 worker + 118 webhook/callback,
      whole suite 423 files / 7581, 24 SQL assertions, 6/6 mutations RED
- [x] draft cron tick repointed at the same function + recovery mode, STILL
      DISABLED — `setup_schedule` is defined and not called by the file
- [ ] OPEN, not mine to close: review -> deploy -> authenticated probe returns
      ok -> only then enable the schedule. The migration stays unapplied.
- [ ] one unexplained intermittent: the 12-session race twice reported
      `errors=2` / once `errors=8` with `rows=1` and `recorded=1` intact, i.e.
      sessions that never answered rather than a dedup fault. Not reproduced
      since; the harness now prints the sessions' own error text on failure.
- [ ] queued UI request runs after this
