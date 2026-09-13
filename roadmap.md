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

`tsc --noEmit` 0 errors · `npm run lint:ci` clean · Prettier clean on every changed file ·
`npx vitest run` **405 files / 7,248 tests, 7,247 passing** — the single failure is the known,
unrelated `arapStep11dDiagnosis` timing flake under load, which passes on its own (measured this
pass) exactly as CLAUDE.md records · `npm run build` succeeded.

## Spend

- Lovable agent credits, read from message metadata and not estimated: dependency turn **5.8**,
  initial repair **13.9**, review **18.7**, this task **20.2**. No blanket "nothing was charged"
  claim is made.
- No Google, OpenAI, GPU or R2 spend: nothing was deployed, published, rendered or generated.
