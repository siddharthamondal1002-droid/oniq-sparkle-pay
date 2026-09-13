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
      `push.ts` records a sanitized reason breakdown instead of a silent success. See
      `src/lib/__tests__/sendPushDiscriminator.test.ts`.
- [x] Item 2 (partial): the video share path no longer reports success when the sheet never opened;
      `src/lib/__tests__/shareActivationFallback.test.ts` covers the cancellation case, which must stay
      a non-error.
- [x] Item 6: measured, and the answer is NO overload. `pg_stat_statements.stats_reset` is NULL, so the
      166 GiB has no window. In the live counters the only temp writers are introspection/tooling
      queries totalling ~4 MiB; every application query writes ZERO temp blocks. No index or memory
      change is warranted — do not add one on the strength of the cumulative figure.

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
- [ ] Item 4 DESIGNED, NOT APPLIED. `provider_spend_ledger` has `estimated_usd`/`actual_usd` and NO
      currency column, so a Lovable-gateway call billed in CREDITS cannot be recorded without either
      inventing a USD conversion (forbidden) or adding columns. Needs an additive migration
      (`currency`, `units_actual`, `provider_receipt_id`) before gateway usage can be booked — and it
      must stay out of the USD caps so credits never charge a direct-provider ceiling.
- [ ] Item 5: production is `bqwttemnnoexadpwifcj` (corroborated at runtime — it serves the 127
      profiles and run #171). `nzbthoecadcwdoqxhaok` is NOT production. Worker image/digest remains
      UNKNOWN from here (repo 404).
