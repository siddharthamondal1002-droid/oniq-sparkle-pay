# SOURCE_BVH_GENERALIZATION_REPORT (consolidated)

**`RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN`**

Five independent routes to a second walking source have now been attempted.
All five closed without an experiment. No evidence was invented. **No classification was upgraded** across any of the five routes, and nothing was promoted.

Route 5 is different in kind from the four before it, and the difference
matters: **routes 1–4 closed on the data. Route 5 closed on the environment.**
100STYLE is very probably exactly the right dataset — the first candidate in
this whole line of work that is plausibly both permissively licensed *and*
rich in ordinary forward walking. It failed here because this container cannot
reach it, which is a policy setting, not a property of the dataset.

## The question, restated

Does right-knee-deeper-flexion follow the **source BVH** when everything
downstream is held constant? The four-character result is not independent
evidence: one BVH drives all four, so the BVH-domain angles are identical **by
construction** — confirmed to 4 dp.

## Route 1 — CMU (subject 0018/0007) → CLOSED

Four stop conditions met, all evidenced:

1. **Unreachable.** `mocap.cs.cmu.edu` 403 over http, CONNECT refused over
   https; proxy relay log records `connect_rejected` at 13:11:47Z. Control:
   `pypi.org` and `registry.npmjs.org` return 200 from the same session.
2. **Licence unverifiable** — steps 1–4 all require reading the CMU site.
3. **Hierarchy unmappable** — ONIQ names 25 joints; fair1 satisfies 25/25, the
   CMU family **5/25**. Missing includes the entire leg chain.
4. **Driver would change** — the damper addresses channels by joint name and
   fails closed: `no rotation channels found for ['RightLeg', 'LeftLeg']`.

Not retried in this loop.

## Route 2 — a second fair1-skeleton walk → NOT_FOUND

95 BVH files, 17 unique by hash, 15 fair1-compatible at 25/25 — but only **4
distinct source motions**; the other 11 are `zombie` derivatives (root
trajectories byte-identical).

Motion decoded, not filename-trusted:

| clip | period | L/R lag | antiphase err | verdict |
|---|---|---|---|---|
| `zombie.bvh` (current) | 48 | 25 | **0.042** | **WALKING** |
| `dab` / `jumping` / `wave_hello` | 8 | 0–7 | 0.75–1.00 | NOT WALKING |

Licence **verified**: AnimatedDrawings MIT, fetched HTTP 200 and byte-compared
against the local checkout. The fair1 clips are cleanly licensed — the blocker
is motion availability.

Root cause of the negative: the fair1 naming convention is the Mixamo/HumanIK
convention, and Mixamo is excluded by owner directive.

## Route 3 — LAFAN1 → REJECTED AT THE LICENCE GATE

Identity and licence **both verified from the authoritative repository**
(`license.txt`, HTTP 200, sha256 `e1124431…`): **CC BY-NC-ND 4.0**.

- **NonCommercial** (§2(a)(1)(A), §1) excludes ONIQ, which is commercial —
  Razorpay integration, a published price chart, a cost model, Creator Program
  payouts.
- **NoDerivatives** (§1, Adapted Material) prohibits exactly what this loop's
  adapter would produce: the source skeleton *translated, altered, transformed*
  into the ONIQ canonical skeleton.
- **Your own standard already decides it** — SFU was excluded for
  research-only/non-commercial terms; CC BY-NC-ND is the same class and stricter.

Secondary: `lafan1.zip` returns a 134-byte **git-lfs pointer** against
144,051,503 declared bytes; LFS media needs the API, which is 403.

No adapter was built. Building `experimental_source_bvh_adapter/` for a
licence-blocked dataset would be scaffolding a path that cannot lawfully be
taken.

## Route 4 — a permissively licensed fair1/HumanIK walk → NOT_FOUND

This is route 1 of "what would actually unblock this", below, executed rather
than assumed. Web search was available and used; **eight** candidates were
evaluated. Ranking is P0 (verified permissive + fair1 skeleton + verified walk)
down to P4.

**P0 = 0. P1 = 0.** The licence gate failed for every candidate, so the
skeleton gate and the motion gate were **never reached**. **0 BVH files were
downloaded.**

| candidate | licence evidence | verdict |
|---|---|---|
| [omimo/PyMO](https://github.com/omimo/PyMO) — `AV_8Walk_Meredith_HVHA_Rep1.bvh` | LICENSE fetched **HTTP 200**, MIT, sha256 `b065610f…` | **REJECTED** |
| [CreativeInquiry/BVH-Examples](https://github.com/CreativeInquiry/BVH-Examples) — `data/walk-cycle.bvh` | LICENSE / LICENSE.md / LICENSE.txt on `master` **and** `main`: all **404** | **REJECTED** |
| [jbrd/usdBVHAnim](https://github.com/jbrd/usdBVHAnim) | Apache-2.0 — code | REJECTED |
| [facebookresearch/fairmotion](https://github.com/facebookresearch/fairmotion) | BSD-3-Clause — code | REJECTED |
| [akjava/BVH-Motion-Creator](https://github.com/akjava/BVH-Motion-Creator) | Apache-2.0 — code | REJECTED |
| Bandai Namco Research mocap | LICENSE **404**; path unresolved | REJECTED |
| [Rokoko](https://www.rokoko.com/) free library | not verifiable without account/ToS | REJECTED |
| CMU Graphics Lab | closed by route 1 | **NOT RETRIED** |

Two rejections deserve their reasoning stated, because both are the traps this
loop was explicitly warned about:

**PyMO** is the closest miss and the most instructive. Its LICENSE really is
MIT and really did return 200 — but its README scopes it in its own words:
*"This **code** is available under the MIT license."* The BVH is third-party
mocap redistributed with no stated origin, credit, or data licence. **A
repository's MIT file does not relicense the data it ships.** Accepting it
would have been inferring a data licence from a repository licence — and the
filename `…8Walk…` would have been inferring motion from a filename on top of
that. Rejected on unclear provenance, not on a defect in the file.

**Bandai Namco** is rejected on two independent grounds, either sufficient: the
licence could not be verified authoritatively from this container (LICENSE
404, and further path attempts would be guessing repository paths), and at
search-snippet level the terms read as CC BY-NC-ND — the same class that closed
LAFAN1. The snippet is recorded as a reason not to pursue it, **never as
licence evidence**. An unverified licence is a rejection, not a maybe. No URL
is cited for it, because citing one I did not successfully fetch would be
manufacturing a citation.

**The systematic finding.** Every permissively licensed result is a **code**
repository. The permissive licence covers the tool, not the motion; the bundled
data is either from an already-closed route (CMU, LAFAN1) or carries no stated
data licence at all. No repository was found supplying *both* a walking BVH
*and* an authoritative data licence permitting commercial use.

The root cause is the same one route 2 surfaced, now confirmed from the other
direction: **fair1 joint naming is the Mixamo/HumanIK convention.** The large
corpora using it are Mixamo (excluded by owner directive) or academic sets under
NC/ND terms. On this evidence, permissively licensed walking mocap in this exact
skeleton is not publicly available.

No substitute was manufactured. The five `FAIR1_WALK_CANDIDATE_*` artifacts were
deliberately **not** produced — there is no candidate for them to describe.

`ALTERNATIVE_FAIR1_WALK_BVH = NOT_FOUND`.

## Route 5 — 100STYLE + isolated experimental adapter → BLOCKED BY NETWORK POLICY

The scientifically correct design: an independent, permissively licensed
walking motion, an **isolated** 28-bone→25-joint adapter that is a
representation change only, and an unchanged ONIQ pipeline downstream. I agree
with the design. It did not get past gate 1.

### Resumed once, from `9c4c26a8`, and stopped in the same place

Gate 1 was re-run in full on 2026-08-23T15:23:52Z.

**Step 1 — attached source BVH: `NO_ATTACHED_SOURCE_BVH`.** Both attachment
mounts (`/mnt/attach`, `/mnt/user-data/working`) are empty and unchanged since
container start. A whole-filesystem scan for `<Style>_FW.bvh`, any `*.bvh`,
`100STYLE*` or `*.fbx` found only ONIQ's own knee-regression fixtures
(`_t3.bvh`, `_t4a`–`_t4d.bvh`), written by `test_knee_regression.py`. **None was
treated as a 100STYLE file.**

**Step 2 — authoritative acquisition: `BLOCKED`.** All seven endpoints
`connect_rejected` 403; `raw.githubusercontent.com` returned 200 in the same
batch.

Two probes 16 minutes apart, identical outcome: this is a **persistent policy
denial, not a transient outage**. Retrying on a schedule will not clear it, so
I am not scheduling one.

**Two fail-closed stop conditions were met**, either of which halts the loop:

1. **The licence could not be verified from the authoritative source.**
2. **The BVH could not be downloaded.**

Both have the same cause. Every host that carries either the authoritative
licence statement or the data is refused by this environment's egress policy at
the CONNECT stage:

| host | what it would have supplied | result |
|---|---|---|
| `ianxmason.github.io` | authoritative licence, naming, hierarchy | `connect_rejected` 403 |
| `www.ianxmason.com` | authoritative licence (author's own domain) | `connect_rejected` 403 |
| `zenodo.org` (record 8127870) | licence metadata **and** `100STYLE.zip` | `connect_rejected` 403 |
| `datashare.ed.ac.uk` | alternate authoritative host | `connect_rejected` 403 |
| `doi.org` | DOI resolution | `connect_rejected` 403 |
| `web.archive.org` | archived copy of the page | `connect_rejected` 403 |
| `github.com` | repository listing | 403 |
| `arxiv.org` | the paper (attribution only) | unreachable |

**Control, fetched in the same batch:** `raw.githubusercontent.com` → **HTTP
200**. The session's network works. These are policy denials, not failures, and
the proxy's own relay log timestamps each one.

### What was found, and why it is not enough

`orangeduck/100style-retarget`, a **third-party redistribution**, is reachable.
It carries the full CC BY 4.0 legal code (`LICENSE.txt`, HTTP 200, 18,650
bytes, sha256 `7e7170e3…`, first line *"Attribution 4.0 International"*, zero
occurrences of `NonCommercial` or `NoDerivatives`) and states verbatim that the
data is *"licensed under the same terms as the original dataset which is
Creative Commons Attribution 4.0 International."*

That is genuine corroboration — meaningfully stronger than a search snippet,
since CC BY 4.0 obliges a redistributor to carry the notice — and it is
**still not the gate**. The directive is explicit that the 100STYLE source
itself must establish the data licence. Recorded as corroboration, graded as
corroboration, and not counted as a pass.

### The substitute I did not take

That same repository hosts a BVH export. I did not use it. It is retargeted
onto a different common skeleton, so it is not the unedited 28-bone source; a
third party's motion-editing step upstream would break the
representation-preservation guarantee **before** ONIQ's adapter starts; its
SHA-256 could not be checked against any official file; and it ships the Geno
character the directive excludes. Its host is blocked in any case. Substituting
it would have been working around a stop condition.

### No adapter was built

The adapter must be validated as representation-preserving **before** the knee
experiment, and every one of those eleven checks compares the source against
the adapted motion. With no source there is nothing to compare, so the
validation cannot exist. Building the adapter anyway would produce an
unvalidatable component and an unverifiable mapping: channel order, rotation
order, rest pose and axis convention are properties of the file, and writing
them from expectation is how a joint gets invented. The lower-body
correspondence the directive specifies (`RightHip/RightKnee/RightAnkle/RightToe`
→ `RightUpLeg/RightLeg/RightFoot`, and its left-side mirror) is recorded as the
agreed plan, **not** as a mapping artifact.

Eight of the eleven requested artifacts were therefore deliberately **not**
produced. The two that are real records of what happened —
`100STYLE_SOURCE_PROVENANCE.json` and `100STYLE_LICENSE.md` — are.

`A / B / C / D` did not run. No comparison, no knee curves, no pixel
diagnostics, no fabricated failure.

### The selection rule, recorded before any 100STYLE motion was seen

Written down now precisely so it cannot later be tuned to a desirable knee
result: *a neutral, ordinary forward-walking sequence named `<Style>_FW.bvh`;
exclude running, sidestep, backward, transition, idle and extreme stylized
gaits; where several qualify, take the lexicographically first qualifying
neutral style.* Deterministic and outcome-blind. **Not applied** — no clip was
obtainable.

### Decision logic, applied honestly

| question | verdict | why |
|---|---|---|
| `SOURCE` | **NEITHER `PRESENT` NOR `ABSENT` — the untouched BVH was never obtained** | the decision requires measuring the source; there is no source |
| `ADAPTER` | **`NOT_DEMONSTRATED`** | no adapter exists, so nothing was demonstrated in either direction. This is the correct verdict, and it is *not* evidence the adapter is innocent |
| `DRIVER` | **NOT CLASSIFIED AS CAUSAL** | the controlled experiment that could attribute a change to the driver did not run. Correlation on one source is not causality |
| `MOTION-SOURCE GENERALIZATION` | **`UNTESTED`** | the independent source never entered the pipeline |

The causal chain `SOURCE → ADAPTER → DRIVER → RENDER` **cannot be separated on
this evidence**, so under the loop's own acceptance condition every link stays
OPEN or UNTESTED. No conclusion is forced.

## Categories

**MEASURED FACT** — BVH knee statistics identical across 4 characters to 4 dp;
`zombie` classifies WALKING (period 48, antiphase error 0.042); AnimatedDrawings
is MIT (verified); LAFAN1 is CC BY-NC-ND (verified).

**DERIVED MEASUREMENT** — 15 `CHAR-DER-*` records, each reproducing its original
and pointing back at it.

**SOURCE-BVH FINDING** (**SOURCE-SPECIFIC**) — right-knee-deeper-flexion,
evidenced on exactly one source BVH. Still the honest classification, and it is
**not promoted**.

**ADAPTER FINDING** — **NONE. UNTESTED.** No adapter was built, so no adapter
has been measured, and no adapter effect can be claimed in either direction.
Route 5 is the loop that would have produced this class, and it stopped before
the adapter existed.

**DRIVER FINDING** — **UNTESTED as a discriminator.** What *is* measured about
the driver is unchanged and holds: 0.50 damping, six rotation channels,
bilateral, at the source-BVH layer, with hip/ankle/root diffs of exactly
0.0000. Whether the driver *causes* the asymmetry cannot be separated from the
source without a second source.

**MOTION-SOURCE FINDING** — **UNTESTED.** This is the whole point of conditions
C and D, and neither ran.

**POTENTIALLY-GENERALIZED** — **UNTESTED.** Nothing may be moved into this class
until an independent source has been through the identical pipeline.

**INFERRED** — foot contact (foot-height minima, groundplane biased to the left
foot by construction); the COM proxy (unweighted joint centroid, not a centre of
mass).

**BLOCKED** — CMU (4 conditions); LAFAN1 (licence); the permissive search
(licence gate, 8/8); **100STYLE (network egress policy — licence unreadable AND
file undownloadable)**; 697 mm records (no scale bridge).

**OPEN** — `RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN`.

**NOT_APPLICABLE** — the alternative-source over-curl re-confirmation, since no
alternative clip exists to inspect. No failure was manufactured. The 100STYLE
over-curl comparison is likewise NOT_APPLICABLE and was **not** simulated.

**PRODUCTION RULE** — unchanged: knee damping **0.50**, six channels, bilateral,
source-BVH layer. No clamp, no Euler limit, no hip/ankle/root/timing/mesh/ARAP/
segmentation change. `productionEligible` **0/1000**. `two_leg_fraction` remains
**DIAGNOSTIC ONLY** (garment-confounded). Render envelope is **per character and
per clip**, never inherited.

## What would actually unblock this

**The cheapest unblock is now an environment setting, not a dataset hunt.**
100STYLE is CC BY 4.0 on every indication available to me and is full of
ordinary forward walking — it is the right dataset. Allow **`zenodo.org`** and
**`ianxmason.github.io`** (or `www.ianxmason.com` / `datashare.ed.ac.uk`) through
this environment's network policy and route 5 resumes at gate 1 and runs
through to A/B/C/D. Failing that, attaching a `<Style>_FW.bvh` to the session
directly needs no policy change at all.

The older list, in rough order of cost:

1. ~~**A fair1/HumanIK-skeleton walking clip under a permissive licence.**~~
   **Searched in route 4 — NOT_FOUND.** This was the cheapest option and it is
   now spent. It is left on the list struck through rather than deleted, so the
   record shows it was tried rather than skipped.
2. **Attach a BVH directly** that you hold rights to. **This is now the cheapest
   remaining route by a wide margin** — it is the only one that needs neither
   procurement nor a network-policy change. One walking BVH you hold rights to,
   in any skeleton, and the experiment runs.
3. **A commercial licence from Ubisoft La Forge** for LAFAN1 — procurement, not
   engineering.
4. **A network-policy allowance for `mocap.cs.cmu.edu`** — but CMU still leaves
   the 5/25 skeleton problem and the adapter/NoDerivatives-free question.

Each is a decision for you. I am not choosing between them, and I did not build
against any of them speculatively.
