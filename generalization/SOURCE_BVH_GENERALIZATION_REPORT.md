# SOURCE_BVH_GENERALIZATION_REPORT — **STOPPED**

The experiment was not run. Two of the loop's own stop conditions were met
before any download, and two more would have been met after it. Nothing was
worked around.

## Verdict

`RIGHT-KNEE-DEEPER-FLEXION` classification remains **MEASUREMENT_OPEN**.

It is still `SOURCE_BVH_SPECIFIC` as far as evidence goes: measured on exactly
one source BVH (fair1 `zombie.bvh`). The replacement test that would have
distinguished `SOURCE_BVH_SPECIFIC` from `POTENTIALLY_GENERALIZED` could not be
run. **No classification was upgraded. Nothing was promoted.**

## Blocker 1 — the CMU source is unreachable from this session

| URL | result |
|---|---|
| `http://mocap.cs.cmu.edu/` | **403** |
| `http://mocap.cs.cmu.edu/faqs.php` | **403** |
| `https://mocap.cs.cmu.edu/` | CONNECT refused |
| `https://www.cs.cmu.edu/` | CONNECT refused |

The agent-proxy relay log records `connect_rejected — gateway answered 403 to
CONNECT (policy denial or upstream failure)` for `mocap.cs.cmu.edu:443` and
`www.cs.cmu.edu:443` at 2026-08-23T13:11:47Z. Control: `pypi.org` and
`registry.npmjs.org` both return **200** from the same session. The network is
up; `cs.cmu.edu` specifically is denied by this session's network policy.

→ **"If the CMU file cannot be obtained cleanly: STOP"** — met.

## Blocker 2 — the licence could not be verified from source

Steps 1–4 (inspect page, verify the exact file, record URL, record the licence
statement) all precede downloading, and all require reading the CMU site. The
authorization message quotes CMU's terms, and I have no reason to doubt the
quote — but **a quoted licence is not a verified licence**, and step 4 asks for
verification from the source.

→ **"If licensing cannot be verified: STOP"** — met.

## Blocker 3 — the skeleton cannot be mapped without changing the mapping

Measured against `examples/bvh/cmu1/jumping_jacks.bvh`, a CMU-derived clip
already bundled with AnimatedDrawings under MIT — the same skeleton family as
the requested subjects.

| | joints satisfied |
|---|---|
| ONIQ retarget config requires | **25** |
| fair1 `zombie.bvh` (current source) | **25 / 25** |
| CMU family | **5 / 25** |

Missing (20): the whole leg chain `LeftUpLeg / LeftLeg / LeftFoot / LeftToeBase`
and mirror, the whole arm chain, and `Spine`…`Spine3`.

| | leg chain naming |
|---|---|
| ONIQ / fair1 | `LeftUpLeg → LeftLeg → LeftFoot → LeftToeBase` |
| CMU family | `LeftHip → LeftKnee → LeftAnkle → LeftToe` |

The controlled test requires *"Same: retarget mapping … Only SOURCE BVH
changes."* That is not satisfiable: the mapping would have to be rewritten.

→ **"If hierarchy cannot be mapped safely: STOP"** — met.

## Blocker 4 — the driver itself would have to change

The knee damper addresses its six channels **by joint name**
(`["RightLeg", "LeftLeg"]`). Run against a CMU-family skeleton:

```
AssertionError: no rotation channels found for ['RightLeg', 'LeftLeg']
```

It fails closed, which is correct behaviour — and is also proof that using a
CMU source would require modifying the driver's joint targets.

→ **"If retargeting requires modifying the ONIQ driver: STOP"** — met.

## What I deliberately did NOT do

- **No third-party mirror or package-registry copy.** `pypi.org` is reachable
  and CMU mocap data is redistributed in packages, so this was available. Its
  licence could not be checked against the unreachable CMU source, and using it
  is precisely the "work around" the loop forbids.
- No retarget-config rewrite to accommodate CMU joint names.
- No damper joint-name remapping.
- No substituting the bundled CMU *jumping jacks* clip for a *walking*
  experiment — it is the right skeleton family but the wrong motion, and the
  loop requires walking confirmed from decoded motion, not from a filename.

## Outputs that could not be produced, and why

| requested | status |
|---|---|
| `ALTERNATIVE_BVH_PROVENANCE.json` | **produced** — records the blocked state and all evidence |
| `ALTERNATIVE_BVH_SHA256.txt` | **produced** — states that no file exists to hash |
| `ALTERNATIVE_BVH_STRUCTURE.json` | **produced** — from the bundled CMU-family skeleton |
| `SOURCE_BVH_COMPARISON.json` | **not produced** — needs clips C and D |
| `SOURCE_BVH_KNEE_CURVES.json` | **not produced** — needs clips C and D |
| `SOURCE_BVH_PIXEL_DIAGNOSTICS.json` | **not produced** — needs clips C and D |

Fabricating the missing three would be inventing measurements.

## What unblocks this

Any **one** of these, and the experiment runs the same day, CPU-only, ₹0:

1. **Allow `mocap.cs.cmu.edu` in this session's network policy.** Then steps
   1–14 run as written. Note blockers 3 and 4 still apply afterwards.
2. **Supply the BVH directly** (attach it). That clears blockers 1 and 2; you
   would still be deciding on blocker 3/4 below.
3. **Decide on the mapping question**, which is genuinely yours: a CMU source
   needs either a *new retarget config* naming CMU joints and a damper invoked
   with `LeftKnee,RightKnee`, or a name-normalisation pass on the incoming BVH.
   Either is a change to the controlled test's "change nothing else" rule, so I
   will not choose it unilaterally. The narrowest option is a **name-mapping
   shim applied to a copy of the incoming BVH**, leaving the ONIQ driver and
   retarget config untouched — but that is still a new component, and it needs
   your word.

Also worth knowing: a source with the **fair1 skeleton** would avoid blockers 3
and 4 entirely. If a second *fair1-format walking* clip exists under a clean
licence, it is a strictly cheaper path to the same answer.

## Unchanged

Knee damping 0.50, six channels, bilateral, source-BVH layer. Reference library,
PR #86, production, determinism policy: untouched. ₹0 API, ₹0 GPU, 0 downloads,
0 new images.
