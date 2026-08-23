# ONIQ VIDEO PAID STRUCTURE — audit

Read-only audit, 2026-08-23, against `claude/resume-3cpm82` @ `1f06aa15` and the
migration history on `main`. **No code was modified. No provider was called. No
credit moved. ₹0 spent.**

---

## Three premises in the brief that the repository contradicts

These are stated first because each one changes the answer downstream.

**1. ONIQ does not use Firebase. It uses Supabase — Postgres 15 with RLS,
`security definer` RPCs and edge functions.** §14's question ("inspect whether
credit accounting is atomic") has a better answer than it assumes: credit
accounting already runs inside single Postgres functions holding `select … for
update` row locks, which is a _stronger_ primitive than a Firestore
transaction. There is no Firebase code in this repository.

**2. The wired video model is Veo 3.1 **Fast**, not Lite.**
`supabase/functions/story-clip/index.ts:41` —
`const CLIP_MODEL = "veo-3.1-fast-generate-preview";`
The in-repo comment prices it at **$0.15/s list**, five times the $0.03/s the
brief assumes. Building a cost model on the Lite figure would understate
provider exposure 5×.

**3. The wired TTS is not Google Standard TTS.**
`supabase/functions/story-voice/index.ts:39` —
`const TTS_MODEL = "google/gemini-2.5-flash-tts";` routed **through the Lovable
gateway**, per the owner directive of 2026-08-14. That is a different provider
_and a different account's money_ (Lovable credits, not a metered Google key).
Per `CLAUDE.md`, which provider and whose money is an owner decision, so this
audit does not propose changing it.

---

## The finding that reframes the whole question

### **`USER BILLING IS CURRENTLY DISABLED. NOTHING CHARGES ANYBODY.`**

Owner directive 2026-08-20, migration
`20260820145330_64cb23b2-878a-4ba6-a09a-68cc7cba5d2d.sql`, "FREE FOR ALL":

- `claim_story_seconds` — the `if is_admin(me)` free branch was widened to
  **every authenticated user**. Every job is inserted with
  `seconds_charged = 0, paid_seconds_charged = 0, no_watermark = true`.
  Comment, verbatim: _"Every authenticated user now rides the free path;
  counters are read but never written."_
- `has_entitlement(_user, _key)` — body is now literally `select true;`.
- `story_quota_status` — reports `remaining = max_story_seconds`,
  `paidSeconds: 0`, `planLabel: 'Free for all'`, no paywall.

So the answer to §3 "when is the user currently charged?" is: **never**, at any
point in the lifecycle. The paid machinery below still exists in the schema and
is fully wired; it is bypassed, not removed. A revert path is named in the
migration header.

### **Second-order finding — the global daily ceiling is no longer enforced.**

`MEASURED FACT.` In the free path, `story_global_usage` is read under
`for update` and **never written**, and the `capacity` refusal
(`global_used + free_spend > cfg.global_daily_seconds`) is **gone**. The
`20260812153000_story_open_to_all.sql` header calls that ceiling _"the thing
that makes this safe to switch on"_ — 3600 s/day across all users. It now
limits nothing.

This is a real exposure, and it should be read at its true size rather than
dramatised: with `STORY_MOVIE` unset the rented clip stage never runs, so the
uncapped exposure is **runner-minutes plus Lovable-gateway credits**, not Veo
dollars. At the measured ₹37.55 per finished minute that is roughly **₹2,250
per uncapped hour of film**. Per-user daily limits are also unenforced.

---

## A. Current architecture

```
StoryStudio (client)
   └─ rpc claim_story_seconds ──────────► story_jobs row (status='queued')
                                            │
   pg_cron ─► story_dispatch_tick ─────────┤ net.http_post
                                            ▼
                                    story-dispatch (edge fn)
                                            │ mints a per-job capability token
                                            ▼
                              GitHub Actions runner: story-worker.mjs
                                    │        │        │
                        story-plot  │  story-still    story-voice   story-clip
                        (script)    │  (images)       (TTS)         (Veo, OFF)
                                    ▼
                              Remotion render (CPU)
                                    │
                              story-callback (edge fn, token-checked)
                                    ▼
                              story-deliver / signed URL
```

Supporting: `story-sweep` (reaper + purge), `razorpay-order` / `razorpay-verify`
/ `razorpay-webhook` (second-purchases), `story_price_tiers` (the only table
that bills).

## B–E. Current billing, credit, QA and retry flow

### The state machine, from the trigger — not from documentation

`story_jobs_guard_transition` (`20260814090000_stale_generating_reaper.sql`)
enumerates every legal edge:

```
queued ──► generating ──► assembling ──► ready ──► delivering ──► delivered
   │            │  │           │  │         │           │  │
   │            │  └──► queued │  └► queued │           │  └──► ready
   │            │              │            │           │
   └──► failed ◄┴──────────────┴────────────┴───────────┘
   └──► purged  (every state may go to purged; failed → purged)
```

**`MEASURED FACT`: there is no `QA` state and no `ACCEPTED` state.** The brief's
target machine (`… → QA → ACCEPTED → DELIVERED`) does not exist. `ready` is
reached the moment bytes are uploaded and signed.

### Where money actually moves

| event           | code                    | effect                                                                                                                                                                                                                                                   |
| --------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| job creation    | `claim_story_seconds`   | **debit** — `story_allowance.period_used_seconds/daily_used_seconds += included`, `paid_seconds -= paid`, `story_global_usage` bumped, and the amounts written onto the job as `seconds_charged` / `paid_seconds_charged`. _(bypassed since 2026-08-20)_ |
| job failure     | `refund_story_seconds`  | **credit back**, idempotent via `refunded_at` under a row lock                                                                                                                                                                                           |
| second purchase | `credit_story_purchase` | **credit** `paid_seconds += p.seconds`, idempotent via `status='paid'` under a row lock                                                                                                                                                                  |

**So the shipped model is debit-on-request + refund-on-failure — a reservation
implemented as a charge and a reversal.** It is _not_ pay-on-acceptance, but the
`seconds_charged` / `paid_seconds_charged` columns on `story_jobs` are exactly
the reservation ledger a pay-on-acceptance design needs. That is the single most
useful thing in the current schema.

### Answers to §3, traced

| event                        | what happens to the credit                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Veo fails                    | clip is discarded, shot **degrades to Ken Burns**; job continues. No refund, because nothing failed.                                                                                                                                             |
| TTS fails                    | worker raises; `fail()` → status `failed` → `refund_story_seconds`. **Refunded.**                                                                                                                                                                |
| QA fails                     | **`OPEN` — there is no whole-job QA gate to fail.** Per-clip aliveness fails _closed_ (discard + degrade), it does not fail the job.                                                                                                             |
| generation times out         | `story-sweep` marks `failed`, then refunds. Marked first, refunded second, deliberately.                                                                                                                                                         |
| user cancels                 | `delete_story_job` → `refund_story_seconds`.                                                                                                                                                                                                     |
| worker crashes               | `story_dispatch_tick`'s reaper returns `generating → queued`; if it never revives, sweep fails+refunds at TTL.                                                                                                                                   |
| final render fails           | `fail()` → `failed` + refund.                                                                                                                                                                                                                    |
| accepted video later deleted | **No refund, correctly.** `delete_story_job` refunds only from `queued`/`generating`/`assembling`/`delivering`; a `delivered` job is purged with the charge intact. I suspected a download-then-delete leak here and checked it — there is none. |
| retry                        | in-worker retries are free; a re-dispatch of the same job never re-debits, because the debit happens once at claim.                                                                                                                              |

### Retry, as shipped

- **Provider-level**: `story-still` and `story-voice` retry inside the edge
  function; `story-clip` retries on 422/502 once each.
- **Job-level**: the reaper returns an abandoned `generating` job to `queued`
  and re-dispatches. There is **no attempt counter and no cap** — `OPEN`.
- **Clip-level**: a clip failing the aliveness gate is _discarded_, and the shot
  falls back to Ken Burns. The film still ships. That is a graceful-degradation
  design, not a retry.

## F. Provider cost model

**Verified from the repository** (`src/lib/storyCostModel.ts`):

| unit                       | value                                         | provenance                                                            |
| -------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| stills + voices            | **₹31.50 / finished minute**                  | owner-supplied **measured** 2026-08-15, replacing a modelled estimate |
| render compute (movie)     | 9 runner-min × $0.008 × ₹84 = **₹6.05 / min** | derived, GitHub overage rate                                          |
| **movie generation total** | **₹37.55 / finished minute**                  |                                                                       |
| Razorpay                   | 2% + 18% GST on fee = **2.36% of price**      |                                                                       |
| fixed infra                | **₹3 / film**                                 | storage, egress, db                                                   |
| GST                        | **18/118 of the inclusive price**             | owner: published price is GST-inclusive                               |

**Veo 3.1 Fast — $0.15/s (in-repo comment, not re-verified today).**

**`OPEN` — provider list prices could not be verified from an authoritative
source in this session.** `ai.google.dev/pricing` is blocked by the egress
policy (`000`); `cloud.google.com/text-to-speech/pricing` returns 200 but the
fetched page truncated before the table. **The brief's $0.03/s Lite and
$4/1M-character TTS figures are therefore recorded as UNVERIFIED and must not
be written into code or billing logic until someone reads the live page.**

### Cost per duration

| duration | Veo Lite @$0.03/s **(UNVERIFIED)** | Veo Fast @$0.15/s (in-repo) | **in-house engine (MEASURED)** | **user price @₹75/min** |
| -------- | ---------------------------------- | --------------------------- | ------------------------------ | ----------------------- |
| 1 s      | ₹2.52                              | ₹12.60                      | ₹0.63                          | ₹1.25                   |
| 6 s      | ₹15.12                             | ₹75.60                      | ₹3.76                          | ₹7.50                   |
| 8 s      | ₹20.16                             | ₹100.80                     | ₹5.01                          | ₹10.00                  |
| 30 s     | ₹75.60                             | ₹378.00                     | ₹18.78                         | ₹37.50                  |
| 60 s     | ₹151.20                            | ₹756.00                     | ₹37.55                         | ₹75.00                  |
| 5 min    | ₹756.00                            | ₹3,780.00                   | ₹187.74                        | ₹375.00                 |
| 10 min   | ₹1,512.00                          | ₹7,560.00                   | ₹375.48                        | ₹750.00                 |

**Cost is not price.** The right-hand column is the sale; the others are what
ONIQ would owe.

**The number that matters most:** switching the Veo Fast clip stage on for a
one-minute film (8 clips × 8 s) costs **₹806** of provider spend against a **₹75**
sale — **10.8× the entire price, before tax**. The worker says so in its own
comment: _"a ₹57 movie sale must never trigger hundreds of rupees of rented
generation"_. Even at the unverified Lite rate the same film costs ₹161 against
₹75 — **still a loss**. `ENGINEERING FINDING`: at today's price chart, **no
rented per-second video stage is affordable at any of the rates on the table.**

## G. User pricing model currently implemented

Model **B/D hybrid, currently inert**: a per-second allowance (`story_allowance`)
fed by a monthly plan (`subscription_plans.included_seconds`) _and_ by one-off
purchases (`story_purchases` → `paid_seconds`), spent per job at
`claim_story_seconds`. Published rate **₹75 / minute, GST-inclusive**
(`20260816090000_seventy_five_a_minute.sql`, `price_paise = round(7500.0 * seconds / 60)`),
strictly linear — no tiers, by owner directive 2026-08-15.

Realised margin at ₹75, as fractions of price: **28.3 % at 1 min, 31.5 % at
5 min, 31.9 % at 10 min** — above the 26 % mandate, because the ₹3 flat infra is
recovered inside the per-minute rate and so is over-recovered on longer films.
The derived floor is ₹71.91; the ₹75 published rate is deliberate headroom.

## H. Gaps

| #      | gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | severity                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **H1** | **No QA/acceptance stage exists.** `ready` means "bytes uploaded", not "accepted". The product principle in the brief cannot be implemented against the current state machine without adding a state.                                                                                                                                                                                                                                                                                                                       | **blocking** for pay-on-acceptance  |
| **H2** | **Billing is disabled entirely** (2026-08-20). Any pay-on-acceptance work is a _design_ for a system that currently charges nothing.                                                                                                                                                                                                                                                                                                                                                                                        | context                             |
| **H3** | **The global daily ceiling is dead** — read, never written, no capacity refusal. Uncapped exposure.                                                                                                                                                                                                                                                                                                                                                                                                                         | **high**                            |
| **H4** | **No retry attempt counter or cap.** The reaper can return a job to `queued` indefinitely; nothing counts attempts or bounds provider spend per job.                                                                                                                                                                                                                                                                                                                                                                        | **high** if billing returns         |
| **H5** | ~~Delete-after-delivery refunds a delivered film.~~ **CHECKED AND FALSE — no leak.** `delete_story_job` refunds only when `status in ('queued','generating','assembling','delivering')`. A `delivered` job is purged **without** refund. The download-then-delete attack does not work. What the same clause _does_ mean is that a job sitting at `ready` — rendered, never delivered — is also purged without refund; that is arguably unfair to the user rather than to ONIQ, and it is a **policy question, not a bug**. | **none** (was suspected, disproved) |
| **H6** | No per-job provider-spend ledger. Nothing records what a job actually cost ONIQ, so retry economics cannot be measured after the fact.                                                                                                                                                                                                                                                                                                                                                                                      | medium                              |
| **H7** | `refund_story_seconds` credits the _daily_ counter back only when `daily_day = charged_day`; a job charged yesterday and refunded today does not restore yesterday's daily room. Correct-by-design, but undocumented as a policy.                                                                                                                                                                                                                                                                                           | low                                 |

## The acceptance contract (§6) — what can actually be automated today

"Zero error" is not mathematical perfection; it is a named contract. Below,
every proposed check is one this repository **already computes**, or could
compute from artefacts it already produces. Nothing here is aspirational.

**`HARD_FAIL` — blocks acceptance, releases the reservation:**

| check                                                           | already exists? | where                                                   |
| --------------------------------------------------------------- | --------------- | ------------------------------------------------------- |
| duration within the sellable band 60–600 s                      | **yes**         | `PREFLIGHT_JOB_INVALID`, worker + `claim_story_seconds` |
| output file exists, non-zero, probes as valid video             | **yes**         | `OUTPUT_VALIDATE` stage marker + asset probe            |
| every planned shot rendered (no missing segment)                | **yes**         | shot plan vs render manifest                            |
| audio track present and non-silent when narration was requested | **yes**         | narration spans are required for lip-sync               |
| delivered duration within tolerance of `requested_seconds`      | **yes**         | `storyPlan`                                             |
| final encode integrity (container/codec readable end to end)    | **yes**         | ffprobe in the worker                                   |
| prohibited content                                              | **partly**      | `media-provenance-scan` exists; coverage `OPEN`         |

**`QUALITY_WARNING` — recorded, never billing-affecting:**

clip temporal aliveness (`CLIP_ALIVENESS_MIN` — today it _discards a clip and
degrades the shot_, which is the right behaviour and must not become a job
failure), character/reference consistency, anatomy artefacts, motion quality,
scene continuity, lip-sync tightness, subtitle correctness.

**`OPEN` — cannot be automated reliably today, and should not be pretended:**
character identity drift across shots, "missing/extra characters", subjective
motion quality. The engineering loops in this repo have measured how hard these
are; none has a reliable automated verdict.

**The design rule this produces:** a warning must never consume a paid
generation. Only the seven HARD_FAIL rows may, and each is a deterministic,
already-computed predicate — which is precisely what makes commit-on-acceptance
safe to automate.

## I–J. Recommended payment and credit state machines

Adding **two** states and **one** table is enough. Both recommendations are
proposals only.

```
queued ─► generating ─► assembling ─► ready ─► QA ─┬─► accepted ─► delivering ─► delivered
                                                   │      ▲            │
                                                   └─► requeue (attempt < MAX)
                                                          │
                                                   attempts exhausted ─► failed (RELEASE)
```

**Credit machine — Option B, reserve → commit.** Not Option A, and not C.

- **A (no reservation, deduct after QA)** is unsafe: nothing stops a user
  queueing fifty jobs against a balance of one. The reservation _is_ the
  admission control, not just the accounting.
- **C (pre-authorize/capture)** maps to a card rail ONIQ does not have here —
  the seconds are a prepaid balance, not an authorization hold. Razorpay
  auth-capture would apply only to the top-up purchase, which is already
  correctly handled.
- **B** is what the schema is already nine-tenths built for: `seconds_charged`
  and `paid_seconds_charged` on the job _are_ the reservation record. The change
  is semantic — treat the existing debit as a **hold**, add
  `story_jobs.credit_state ∈ {reserved, committed, released}`, and let refund
  become "release" rather than a special case.

```
reserve (at claim, as today) ─► committed  (on ACCEPTED, once, idempotent)
                              └► released  (on failed/cancel/exhausted)
```

The user-visible promise — _"a failed generation never consumes your
entitlement"_ — is then true, while admission control stays intact.

## K. Retry policy

`MAX_ATTEMPTS` cannot be derived from evidence in this repository: **there is no
first-pass acceptance-rate telemetry, because there is no acceptance gate to
measure.** `OPEN`.

What _can_ be said: the bound must come from **maximum ONIQ exposure per sale**,
not from a guess about quality. With in-house generation at ₹37.55/min against a
₹63.56 net-of-GST minute, break-even is at **1.57 attempts** (₹75 less ₹11.44 GST, ₹1.77 Razorpay and ₹3 infra leaves ₹58.79 for generation); a second full
attempt costs ₹75.10 and puts the sale under water. So on the current cost
structure, `MAX_ATTEMPTS = 2` is the _economically_ defensible ceiling, and 3
only becomes defensible if per-attempt cost falls or price rises. **3 is not
correct today** — the brief was right to flag the assumption.

Recommendation: instrument first (H6 + an acceptance gate), set the bound from
measured data, and until then bound by **spend**, not by attempt count.

## L. Refund policy

**Already correct, and it survived the attack I aimed at it.** Idempotent under a
row lock, revoked from `authenticated`, and scoped to pre-delivery states only —
so there is no download-then-delete leak (H5). One change recommended, and it is
cosmetic rather than corrective:

1. Rename the concept to _release_ under the reservation model, so a genuine
   post-acceptance refund is visibly a different and rarer act than releasing a
   hold on a job that never shipped.
2. `OPEN` — decide the policy for a job purged from `ready` (rendered, never
   delivered): today it keeps the charge. That is a product call, not a defect.

## M. Provider escalation policy

**Recommendation: keep escalation disabled.** This is not a close call —
§F shows the cheapest rented per-second video on the table costs more than the
whole sale. Escalation to Fast/Standard cannot be an ONIQ-absorbed cost at
₹75/min, and charging the user for a _retry_ contradicts the product principle
in the brief. `STORY_MOVIE` should stay unset. Any change here is an owner
decision about provider and money, not an engineering call.

## N. Security / idempotency findings

**Good, and worth stating plainly — this part is well built:**

- **Billing is server-authoritative.** `claim_story_seconds`,
  `refund_story_seconds` and `credit_story_purchase` are all `security definer`
  with `revoke all … from public, anon` — `refund_story_seconds` is revoked from
  `authenticated` too. A client cannot call the refund path at all.
- **The client cannot assert QA or payment status.** `story-callback` verifies a
  per-job capability token and checks it names the job being changed; the
  storage path is _derived from the job id_, not accepted from the body. The
  claim is atomic — `PATCH … &status=eq.queued`, so a second runner loses.
- **Purchase credit is idempotent** — `for update` + `status='paid'` early
  return. A replayed webhook credits nothing twice.
- **Refund is idempotent** — `refunded_at` checked under the row lock.
- **A late `payment.failed` cannot revoke paid seconds** — `fail_story_purchase`
  never touches the allowance.
- **Negative balances are structurally prevented** — `spend_paid := least(…, a_paid)`.

**Open risks:**

| ref    | risk                                                                                                                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N1** | **Duplicate client submission is not idempotent.** `claim_story_seconds` takes no idempotency key; two taps create two jobs and two debits. Both are refundable, but the user sees double. **Recommend a client-supplied `request_id` with a unique index.**                      |
| **N2** | **No attempt/spend bound** (H4) — a pathological job can be re-dispatched without limit.                                                                                                                                                                                          |
| **N3** | ~~delete-after-delivery refunds~~ — **tested, does not exist.** Kept in the list so the next reader knows it was checked rather than missed.                                                                                                                                      |
| **N4** | Concurrency between two _different_ jobs of the same user is serialised correctly by `select … for update` on `story_allowance`; concurrency between a claim and a refund likewise. No deadlock path found (both take the allowance row after the job row, consistently ordered). |

## O. Required code changes (proposal only — nothing was changed)

1. Add `qa` and `accepted` to `story_jobs.status` and to the transition trigger.
2. Add `story_jobs.credit_state`, `attempt_count`, `provider_cost_paise`.
3. Split `refund_story_seconds` into `release_story_reservation` (pre-acceptance)
   and `refund_delivered_story` (admin-only, audited).
4. Add `commit_story_reservation(job_id)` — one `security definer` function that
   verifies ownership, status, QA verdict and reservation, commits, marks
   accepted and issues the delivery entitlement **in one transaction**, exactly
   as §14 asks. Postgres gives this for free; no distributed transaction needed.
5. Add the idempotency key (N1).
6. Add a per-job spend ledger (H6) and a spend bound (H4).
7. Restore the global capacity check (H3) — **or** have the owner confirm the
   ceiling is intentionally retired.

## P. Required tests

All eighteen the brief lists are appropriate, and the repository already has the
scaffolding for them: `storyJobsSchema.test.ts` parses migration SQL and asserts
on function bodies and grants, so a billing invariant can be pinned **without a
database**. That is the cheapest place to add 1–18.

The invariant to assert, in the brief's own words:

> **A user's paid generation credit is consumed at most once and only for an
> accepted output.**

**Today the system does not satisfy it — but not by over-charging.** It consumes
credit at _request_ time rather than acceptance, and it currently consumes
nothing at all. The violation is of the "only for an accepted output" clause,
mitigated by a refund path that is correct and idempotent.

### The eighteen, mapped to what exists

| #   | test                      | status today                                                  |
| --- | ------------------------- | ------------------------------------------------------------- |
| 1   | successful generation     | covered end-to-end by `storyDryRun` / `storyLifecycle`        |
| 2   | QA failure                | **cannot be written — no QA gate**                            |
| 3   | retry                     | partial (`storyReaper`, `storyStageRecovery`)                 |
| 4   | final success after retry | partial                                                       |
| 5   | all retries exhausted     | **no attempt cap to exhaust**                                 |
| 6   | provider failure          | covered (`storyDispatchHealth`)                               |
| 7   | TTS failure               | covered (worker `fail()` path)                                |
| 8   | timeout                   | covered (`storyReaper`)                                       |
| 9   | worker crash              | covered (reaper revive)                                       |
| 10  | duplicate worker          | covered — the `status=eq.queued` atomic claim                 |
| 11  | duplicate client request  | **MISSING — N1**                                              |
| 12  | cancellation              | covered (`deleteStoryJob`)                                    |
| 13  | insufficient credits      | covered in schema tests (`exhausted`/`daily`/`too-long`)      |
| 14  | concurrent jobs           | implicitly covered by the `for update` lock; no explicit test |
| 15  | QA bypass attempt         | **cannot be written — no QA gate**                            |
| 16  | duplicate payment         | covered (`credit_story_purchase` idempotency)                 |
| 17  | refund path               | covered (`storyJobsSchema`)                                   |
| 18  | idempotent finalization   | **MISSING — no finalize step exists**                         |

Five of the eighteen are unwritable until the acceptance gate exists. That is
the clearest single argument for building it before anything else in §O.

## Q. Production rollout plan

Nothing here should ship without an owner decision, because re-enabling billing
is a business change. Sequenced for safety:

1. **Owner decision**: does billing come back at all, and at what price? Until
   then everything below is dormant.
2. Ship the QA/accepted states and `credit_state` **inert** — written, never
   read for gating.
3. Backfill `credit_state` from `seconds_charged`/`refunded_at`.
4. Turn on the acceptance gate in **report-only** mode; measure first-pass
   acceptance for two weeks. _This is what makes K answerable._
5. Set `MAX_ATTEMPTS` and the spend bound from that data.
6. Flip commit-on-acceptance behind a config row, not a deploy.
7. Restore the global ceiling before, not after, step 6.

## R. Recommended pricing structure

**This section recommends a mechanism, not a number.** Prices are the owner's
call under `CLAUDE.md`, and the current chart is already owner-set.

- **Keep ₹75/minute, GST-inclusive, linear.** It clears the 26 % mandate at
  28.3 % on the worst case (1 min) and is derived from a _measured_ cost.
- **Keep the in-house engine as the movie grade.** Every rented per-second
  option on the table loses money at this price.
- **Charge per accepted minute, not per requested minute** — bill
  `min(requested, delivered)` at commit, so a film that comes back short costs
  less. The reservation model makes this natural.
- **`PROVIDER_GENERATION_COST` and `USER_CREDIT_COST` must be separate
  columns**, as the brief says. Today only the second exists.

---

## The question, answered directly

> _Exactly how should ONIQ charge the user for AI video generation while
> ensuring that failed/internal generations never consume the user's paid
> entitlement?_

**Reserve at request, commit at acceptance, release on any terminal failure —
with the reservation, the commit and the entitlement all written by one
`security definer` Postgres function under a row lock.**

Concretely:

1. `claim_story_seconds` keeps its debit, **relabelled a reservation**
   (`credit_state='reserved'`). It stays the admission control — without it a
   user can queue unlimited work.
2. Provider attempts happen against the reservation, bounded by a **spend**
   ceiling and an attempt counter.
3. A new `qa` state runs the mandatory contract. **HARD_FAIL** → requeue or, when
   the bound is hit, `failed` + **release**. **QUALITY_WARNING** → recorded,
   never billing-affecting, exactly as the brief requires.
4. `commit_story_reservation` flips `reserved → committed` and `qa → accepted`
   in one transaction, idempotently — a second worker's commit is a no-op.
5. Delivery is entitled by the commit, not by the upload.
6. Provider cost is recorded per job, separately from the user charge, so retry
   economics become measurable instead of assumed.

**And the honest caveat:** none of this is urgent, because **nothing is being
charged today**. The two things that _are_ live risks under the current
free-for-all — the dead global ceiling (H3) and the unbounded retry path (H4) —
cost ONIQ money right now, with no user-billing question attached at all. If
only one thing is done from this audit, it should be those two.

---

**Status of this document:** audit only. No production change, no deploy, no
merge, no provider call, no credit movement. Anything marked `OPEN` stayed open.
