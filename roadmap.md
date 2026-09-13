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

- [ ] Item 1 BLOCKED, and the blocker is the installer, not the advisories. Every fix is in-range
      (no semver-major): @xmldom/xmldom 0.9.12, brace-expansion 5.0.9, browserslist 4.28.9,
      baseline-browser-mapping 2.11.23, dompurify 3.4.15, fast-uri 4.1.4, hono 4.13.7, js-yaml 4.3.2,
      nanoid 3.3.19, postcss 8.5.28, qs 6.16.0, vitest ^4.1.11. Three measured obstacles: 1. `npm install --package-lock-only` CRASHES on this tree —
      `TypeError: Cannot read properties of null (reading 'edgesOut')` in arborist's peer-set
      walk for `vitest`. It crashed identically BEFORE any edit (the first `npm audit fix`), so
      it is pre-existing and not caused by the overrides. 2. The platform installs with BUN, which "does not support nested overrides" — so the scoped
      `{"@lovable.dev/mcp-js": {"esbuild": ...}}` form cannot be used here. 3. The installer enforces a MINIMUM RELEASE AGE of 86400s; `baseline-browser-mapping@2.11.23`
      was refused for being under 24h old.
      The edit was reverted so package.json and package-lock.json stay consistent — a package.json the
      lockfile does not match breaks `npm ci`, which is a worse outcome than the advisories.
      NOT residual-by-choice: @capacitor/cli / xcode / uuid, whose only fix npm marks semver-major.
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
- [ ] Item 4 REMAINING: `gatewayVoice.ts` (story-voice) is not yet wired, and nothing reconciles a
      PENDING row — the gateway discloses no price at call time, so every row booked today stays
      PENDING until a receipt source exists. Neither is deployed.
- [ ] Item 5: production is `bqwttemnnoexadpwifcj` (corroborated at runtime — it serves the 127
      profiles and run #171). `nzbthoecadcwdoqxhaok` is NOT production. CORRECTION to the earlier
      "repo 404": the worker repository is reachable after all —
      `siddharthamondal1002-droid/oniq-gpu-worker` is PUBLIC and its source, CI run and
      image-publish run are readable through the GitHub API; the 404 was this container's Git
      transport, not the repository's visibility, and reading one as the other is what stalled the
      checkpoint diagnosis. What is still UNKNOWN from here is which image DIGEST the live RunPod
      endpoint is actually running, which is an endpoint fact and not a repository one.

## Spend

- Lovable agent credits consumed by this work: `cost_credits` 13.9 (read from the message objects,
  not estimated). No Google, OpenAI, GPU or R2 spend: nothing was deployed, published or rendered.
