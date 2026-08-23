# SOURCE_BVH_GENERALIZATION_REPORT (consolidated)

**`RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN`**

Three independent routes to a second walking source have now been attempted.
All three closed without an experiment. No evidence was invented.

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

**BLOCKED** — CMU (4 conditions); LAFAN1 (licence); 697 mm records (no scale
bridge).

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

1. **A fair1/HumanIK-skeleton walking clip under a permissive licence.** Avoids
   the adapter entirely — no NoDerivatives problem, no mapping, no driver change.
2. **Attach a BVH directly** that you hold rights to.
3. **A commercial licence from Ubisoft La Forge** for LAFAN1 — procurement, not
   engineering.
4. **A network-policy allowance for `mocap.cs.cmu.edu`** — but CMU still leaves
   the 5/25 skeleton problem and the adapter/NoDerivatives-free question.

Each is a decision for you. I am not choosing between them, and I did not build
against any of them speculatively.
