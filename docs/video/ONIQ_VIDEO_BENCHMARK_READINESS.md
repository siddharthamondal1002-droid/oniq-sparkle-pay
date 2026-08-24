# ONIQ_VIDEO_BENCHMARK_READINESS

**Status** `READY_FOR_CREDENTIALS` · **Provider spend to date on this work** $0 ·
**Date** 2026-08-24

There is **no benchmark evidence in this repository.** Lite-vs-Fast acceptance
is `NOT MEASURED`, and every acceptance field is null. This document describes
what has been _prepared_ so that the first real run needs credentials and an
authorisation — not another redesign.

---

## 1. Where each provider actually stands

| Provider                | Static readiness | Live readiness | Production   |
| ----------------------- | ---------------- | -------------- | ------------ |
| Gemini Developer API    | **PASS**         | NOT_VERIFIED   | **Disabled** |
| `google-agent-platform` | **PASS**         | NOT_VERIFIED   | **Disabled** |
| Runway                  | n/a              | UNVERIFIED     | **Disabled** |

**Static readiness means the shape is right, and nothing more.** Every provider
response used to prove it is a hand-written fixture, labelled in the test file
as `MOCK — NOT_LIVE_EVIDENCE`. No authenticated call has been made to either
Google surface from this repository. Anyone reading "PASS" as "it works" is
reading it wrong, which is why the two columns are separate.

Runway stays `UNVERIFIED`, `UNPRICED` and unselectable: `video_jobs` has 0 rows,
a credit is not a dollar until someone reads an invoice, and `videoUsd()` throws
for it so admission refuses.

## 2. The two Google surfaces are different products

| Surface                 | Lite            | Fast            | Can decline audio? |
| ----------------------- | --------------- | --------------- | ------------------ |
| Gemini Developer API    | $0.05/s + audio | $0.10/s + audio | **No**             |
| `google-agent-platform` | $0.03/s video   | $0.08/s video   | **Yes**            |

Verified against `@google/genai` 2.18.0: `generateAudio` is **rejected** by the
MLDev converter and **mapped** by the Vertex one. So the Developer API cannot
buy the video-only SKU at any price, and `BENCHMARK_MATRIX` encodes that — the
two AI-Studio cells are `VEO_NATIVE_AUDIO`, the two Agent-Platform cells are
`VIDEO_ONLY`. A test asserts it, because "just send `generateAudio: false`" is
the exact mistake the SDK evidence disproved.

Prices are **not restated** in the benchmark module; they are looked up from
`videoRouting.VIDEO_RATES`, so a rate correction cannot leave a stale copy
behind.

## 3. Configuration is a typed refusal, never a failed request

`requireProviderConfiguration(provider, isPresent)` returns
`CONFIGURATION_FAILURE` with `PROVIDER_CONFIGURATION_MISSING: <NAMES>` before
anything opens a socket.

Two reasons, and the second is the expensive one:

1. an unconfigured surface cannot succeed, so calling it is pure latency;
2. **a request that leaves the box may be billed.** A failure ONIQ can predict
   for free must never become one it pays to discover.

`configRequirements()` returns environment variable **names**. Values are never
read, never returned, never logged.

## 4. Failure taxonomy

`VideoOutcomeKind` names thirteen outcomes. The transport judgement is
**delegated** to `providerError.ts` rather than re-implemented — that module
already knows the distinction a previous benchmark paid to learn:

> A daily quota and a per-minute rate limit both arrive as **HTTP 429** and need
> opposite handling. One is a wall with a clock on it; the other clears on its
> own.

So `QUOTA_EXHAUSTED` and `RATE_LIMITED` are separate kinds, split on the body.
A test asserts `videoProvider.ts` contains no `RESOURCE_EXHAUSTED` regex of its
own — two taxonomies drifting apart would leave the wrong one in the generation
path.

`mayHaveBeenBilled(kind)` is what the ledger branches on. A configuration or
auth failure never reached the provider and may be **released**; a `TIMEOUT` is
ambiguous and must **settle**, because the clip may exist and be charged for.

Routing semantics are unchanged: only `MOTION_COMPLEXITY` returns
`ESCALATE_TIER`; a responsible-AI refusal returns `FIX_PROMPT`.

## 5. The corpus that does not exist yet

`remotion/public/sheets/cut/*.png` **must not be used.** Those are
character-design sheets — authored to look good, already evaluated, several
hand-picked for earlier demos. Benchmarking on them measures how flattering the
input was. They are **not deleted**: they are legitimate production assets, they
are simply not evidence.

`validateCorpus()` enforces the requirement rather than describing it. A
manifest is rejected for: `EMPTY`, `NOT_FROZEN`, `DUPLICATE_SOURCE_ID`,
`CONTAMINATED_SOURCE` (path-pattern match on the sheets), `MISSING_HASH`,
`INCONSISTENT_SECONDS` (different durations compare different products), and
`NO_GENERATIVE_CLASS` (a corpus of stills measures nothing about a video model).

**No corpus has been created.** Only the schema and its validator exist; no
image or video was generated in this work.

## 6. Blinding is built into the plan

The previous benchmark was discarded because the evaluator could see the tier.
That is unfixable afterwards — you cannot un-see a label. So blinding lives in
the plan the run is generated _from_:

- opaque labels `B001`, `B002`, … and nothing else;
- **shuffle first, label second.** Labelling first would make `B001..B003` a
  contiguous run of one cell — a label with the answer written on it;
- the mapping is a separate structure; `evaluatorView()` carries only label and
  duration, and a test asserts it leaks no term from `UNBLINDING_TERMS`;
- the shuffle is a **seeded** splitmix32 — a plan nobody can re-derive cannot be
  audited. Re-seeding re-randomises the mapping; the label sequence stays
  `B001..B0NN`, which is the point: the sequence itself carries nothing.

## 7. Acceptance is recorded, never computed

`AcceptanceRecord` = `sampleId`, `motionClass`, `accepted`, `rejectionReason`,
`evaluationVersion`, `evaluator`, `timestamp`.

`validateAcceptance()` requires **complete coverage** of the plan. Partial
coverage is how a benchmark accidentally reports the samples someone felt like
scoring, which skews toward the memorable ones in either direction. A rejection
without a reason is refused; so is a reason attached to an acceptance.

`unblind()` refuses on an invalid scoring set rather than returning a partial
answer — a partially-unblinded benchmark is the one that gets quoted.

`CLIP_ALIVENESS_MIN = 0.75` remains what it always was: a **technical liveness
floor**, not a quality threshold, and not three of them.

The seven motion classes are mirrored from `src/lib/motionProvider.ts`:
`STATIC`, `CAMERA_ONLY`, `CHARACTER_MOTION`, `WALKING`, `TALKING`, `GESTURE`,
`INTERACTION`. Five are generative; two are answered by a still.

## 8. The gate that protects the first paid probe

`firstProbePreflight()` requires **all nine**, with no override:

```
credentialsPresent · providerConfigured · generationAllowed · spendCapsConfigured
jobBudgetAvailable · dailyBudgetAvailable · attemptAvailable
manifestFrozen · evaluationVersionFrozen
```

Anything missing → `NO_PROVIDER_CALL` plus the list of blockers. An **absent**
precondition counts as unmet — omission is not permission, the same rule
`chooseTier()` applies to its routing gate.

`generationAllowed` is listed separately on purpose. Credentials existing, caps
being configured and the benchmark being ready are **not** authorisation. Only
the owner may set `enabled = true`, and today it is **false**.

## 9. The spend path, when it eventually runs

```
benchmark harness → ONIQ provider interface → spend ledger → provider
```

never

```
benchmark harness → provider SDK
```

Every sample passes through `admit_provider_spend` first. The intended order is
configuration → availability → **admission** → reservation → request → poll →
retrieval → settlement → outcome → acceptance. A provider call that discovers a
budget problem afterwards has already spent the money.

On failure: admission → reservation → failure → release → **the attempt stays
consumed**. And a provider's reported actual is settled as reported, never
clamped to the reservation.

## 10. Financial state

|                                |            |
| ------------------------------ | ---------- |
| `request_usd_cap`              | **$1.00**  |
| `job_usd_cap`                  | **$5.00**  |
| `daily_usd_cap`                | **$50.00** |
| `max_attempts_per_job`         | **3**      |
| effective current job exposure | **$3.00**  |
| `generation_allowed`           | **false**  |

See ONIQ_AI_FINANCIAL_CONTROL §2 for why $5.00 is deliberately above the $3.00
the retry ladder can reach.

## 11. What is actually left

- **live provider credentials** — all absent
- **live Supabase access** — no service-role key, so nothing is applied to production
- **a clean corpus** — schema only; no assets created
- **benchmark execution** — needs credentials plus authorisation
- **Agent Platform live probe** — never attempted
- **explicit VIDEO enablement** — the owner's decision, still not made
