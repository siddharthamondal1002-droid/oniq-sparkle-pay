# CHARACTER LIBRARY — BATCH 2 HARDENING REPORT (2026-08-23)

## 1. Repo state

- Production `main` = `ec8fd137` — unchanged behaviorally all loop.
- Work branch `claude/cpu-motion-generalize` = `457598ad` (clean tree; the
  parked v2 branch, reassessed in §5 below).
- PR #83 (Wan GPU provider) untouched, head `1f06aa15`, still HELD.
- No PR opened, nothing merged, no gate weakened, ₹0 GPU/API spend,
  0 Lovable credits this loop (the §12 scale round did NOT run — see §5).
- Batch 1 controls immutable and re-verified byte-exact before judging:
  masters `1be5e7a2`/`4d460141`/`27b7f0e1`, walks `854a0fbc`/`b18652f5`/
  `b5e0ee70`, idles `92f875cf`/`6a39e9d0`/`dc3ea044`.

## 2. Experiments (single variable each, per loop §3–§7)

Defect under iteration: trailing-leg over-curl at walk frame ~100 (the one
shared limit behind Basma's and Rashid's ACCEPT_WITH_LIMITS).

**Experiment 1 — leg amplitude ×0.85** (`zombie_legs085.bvh`: the 24
leg-rotation channels scaled 0.85 toward frame 0, wrap-safe; all else
stock). Renders: basma 7.19 ALIVE, rashid 8.73 ALIVE. Pixel verdict at
f100: curl only marginally reduced on both characters → **INSUFFICIENT**.
Per §7's no-repeated-tuning rule, not iterated further.

**Experiment 2 — foot pin** (`zombie_footpin.bvh`: the 12 Foot/ToeBase
rotation channels pinned to frame 0; all else stock). Renders: basma 7.09
ALIVE, rashid 8.63 ALIVE — identical to control, which triggered an
integrity check: the renders differ from control by **≤ 15 pixels per
frame** (sampled every 20th frame; basma 5–15 px, rashid 1–4 px of
250,000). The foot pin is a measured **NULL-OP** through the retarget:
Foot/ToeBase rotation channels do not visibly project into the 2D ARAP
pose. The curl therefore originates upstream (knee/hip chain + ARAP mesh
deformation), not in foot channels.

## 3. Pixel verdict table (f100 defect frame, three-way)

| character | CTL (Batch 1) | AMP ×0.85 | FOOT-PIN | superior? |
|---|---|---|---|---|
| basma | trailing-leg over-curl | marginally reduced | unchanged (null-op) | NO |
| rashid | trailing-leg over-curl (boot ribbon) | marginally reduced | unchanged (null-op) | NO |

f140 stance check (PIN): grounded symmetric stance, no new artifacts — but
moot, since PIN changes nothing measurable.

## 4. §7 ruling

Neither experiment is demonstrably superior. **Batch 1 is retained as the
accepted baseline. The trailing-leg over-curl at f100 is reported
UNRESOLVED.** It remains a smooth anatomical ribbon-bend, not a
negative-catalogue artifact — the ACCEPT_WITH_LIMITS verdicts stand as
issued. §8: with no winning fix, the urchin was not re-rendered; it remains
the Batch-1 stress fixture (STRESS FAIL, thin-limb class, unchanged).

Root-cause note for any future (owner-approved) attempt: the defect lives
in the knee/hip rotation chain as deformed by the ARAP mesh, so candidate
levers are the retarget's leg joint mapping or knee-channel damping — BVH
foot channels are proven dead ends, and blanket amplitude reduction is
proven too weak at 0.85 without risking gait liveliness below it.

## 5. Section outcomes

- **§9 regression: CLEAN.** regression.sh 3/3 hash-identical
  (aladdin_hand, aladdin_auto, morgiana); all 9 Batch-1 control hashes
  intact.
- **§10 adoption: PREPARED, NOT EXECUTED.** `adoption_staging/
  ADOPTION_MANIFEST.json` stages basma+rashid (targets
  `remotion/public/sheets/{basma,rashid}.png`, SHA-256 + bytes +
  provenance + gate metrics). Nothing copied into the repo; urchin
  excluded. Note: §10's "after fix accepted" precondition was met only in
  the retain-Batch-1 sense — adoption would carry the documented f100
  limit. Owner call.
- **§11 parked branch 457598ad: RECOMMEND MERGE.** Diff vs main: 6 files,
  +364/−44 — gate v2 in `arapProvider.ts` (+23/23 tests), 24 px autorig
  padding, `bvh_idle_reference.py`, visual spec + corpus docs. Re-verified
  today: tsc clean, lint:ci clean, 23/23 provider tests, regression 3/3.
  Behavior risk is minimal: the ARAP provider is owner-gated off in
  production, and the two Python scripts run only in offline rig
  derivation, never in the serving path. Merging changes no live behavior;
  it lands the border-cut root-cause fix and the honest gate. **Stopping at
  the recommendation per the loop — no PR opened.**
- **§12 scale round: NOT RUN.** Its precondition (hardening fix accepted)
  failed. 0 credits spent.

## 6. Evidence (this branch)

`EVIDENCE_SHA256.txt` covers every artifact. `batch1/` = the six accepted
control renders + refset montages (byte-identical to the recorded control
hashes). `batch2/` = both experiment drivers (`zombie_legs085.bvh`,
`zombie_footpin.bvh`), all four experiment renders, the three-way f100
comparison, f100 leg zooms, and the PIN f140 stance frame.
`adoption_staging/` = the prepared (not executed) manifest.

Per §14: evidence frozen, nothing merged, nothing deployed, nothing
adopted. Awaiting explicit owner approval for: (a) merging 457598ad,
(b) executing basma/rashid cast adoption with the documented limit,
(c) any further attempt on the f100 curl via the retarget leg mapping.
