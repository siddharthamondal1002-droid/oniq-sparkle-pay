# SOURCE_BVH_GENERALIZATION_REPORT (consolidated)

**`RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN`**

Four independent routes to a second walking source have now been attempted.
All four closed without an experiment. No evidence was invented. **No classification was upgraded** across any of the four routes, and nothing was promoted.

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

## Categories

**MEASURED FACT** — BVH knee statistics identical across 4 characters to 4 dp;
`zombie` classifies WALKING (period 48, antiphase error 0.042); AnimatedDrawings
is MIT (verified); LAFAN1 is CC BY-NC-ND (verified).

**DERIVED MEASUREMENT** — 15 `CHAR-DER-*` records, each reproducing its original
and pointing back at it.

**SOURCE-SPECIFIC** — right-knee-deeper-flexion, evidenced on exactly one source
BVH. Still the honest classification.

**MOTION-SOURCE-SPECIFIC / ADAPTER-SPECIFIC / DRIVER-SPECIFIC /
POTENTIALLY GENERALIZED** — all **UNTESTED**. Distinguishing them is precisely
what a second source would do, and no second source passed the gates.

**INFERRED** — foot contact (foot-height minima, groundplane biased to the left
foot by construction); the COM proxy (unweighted joint centroid, not a centre of
mass).

**BLOCKED** — CMU (4 conditions); LAFAN1 (licence); the permissive search
(licence gate, 8/8); 697 mm records (no scale bridge).

**OPEN** — `RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN`.

**NOT_APPLICABLE** — the alternative-source over-curl re-confirmation, since no
alternative clip exists to inspect. No failure was manufactured.

**PRODUCTION RULE** — unchanged: knee damping **0.50**, six channels, bilateral,
source-BVH layer. No clamp, no Euler limit, no hip/ankle/root/timing/mesh/ARAP/
segmentation change. `productionEligible` **0/1000**. `two_leg_fraction` remains
**DIAGNOSTIC ONLY** (garment-confounded). Render envelope is **per character and
per clip**, never inherited.

## What would actually unblock this

In rough order of cost:

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
