# SOURCE_LICENSE — LAFAN1 (Ubisoft La Forge Animation Dataset)

## Verified licence

**Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International**
(CC BY-NC-ND 4.0)

- Fetched from `https://raw.githubusercontent.com/ubisoft/ubisoft-laforge-animation-dataset/master/license.txt`, **HTTP 200**
- Licence text sha256 `e11244310739afea404794c9405967a13abdbe7e2492052e94d7c81fe27c8b66`
- The README independently states the same: *"This dataset can be used under the
  Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International
  Public License (see license.txt)."*

The licence **was** independently verified. It verifies as **incompatible**.

## Why it fails, in the licence's own words

**§2(a)(1)(A)** — grants the right to *"reproduce and Share the Licensed
Material, in whole or in part, **for NonCommercial purposes only**"*.

**§1, NonCommercial** — *"not primarily intended for or directed towards
**commercial advantage or monetary compensation**."*

ONIQ is a commercial product. In this repository: `src/lib/razorpay.ts`
(payment integration), `src/lib/storyPricing.ts` (*"The published price chart
for Story time"*), `src/lib/storyCostModel.ts`, margin targets, and Creator
Program payouts. The NonCommercial clause excludes this use.

**§1, Adapted Material** — *"material … derived from or based upon the Licensed
Material and in which the Licensed Material is **translated, altered, arranged,
transformed, or otherwise modified**."*

This loop's own adapter design is `EXTERNAL SOURCE SKELETON → ONIQ CANONICAL
25-JOINT SKELETON`. That is Adapted Material by definition, and **NoDerivatives**
prohibits sharing it.

## The owner's own standard already decides this

The CMU authorization said:

> *"Do NOT use SFU as the production/commercial validation source because its
> database explicitly states research-only/non-commercial use."*

LAFAN1 is the same class and **strictly more restrictive** — CC BY-NC-ND adds
NoDerivatives on top of NonCommercial. Applying the standard you set for SFU,
LAFAN1 must be excluded. I did not treat this as my call to override.

## What was and was not done

- Fetched, for verification only: `README.md`, `license.txt`, and a 134-byte
  git-lfs pointer. **No motion data.**
- **No BVH downloaded.** No adapter built. No experiment run.
- CMU not used or retried. No PyPI mirror. Mixamo and SFU not used. No guessed
  repository URLs — only the documented canonical LAFAN1 path was requested, and
  404s were not probed around.

## Secondary blocker (would matter only if a licence were obtained)

`lafan1/lafan1.zip` returns a **git-lfs pointer**, not data:

```
version https://git-lfs.github.com/spec/v1
oid sha256:ea918082b500a5d158e9d3aa39039df04cd42e25f5c02fe8f7e88e8e9365a977
size 144051503
```

134 bytes returned against 144,051,503 declared. LFS media needs the LFS API;
`api.github.com` and `codeload.github.com` are 403 in this session. That `oid`
is the **dataset author's declared hash transcribed from the pointer** — it is
not a hash of bytes held here and is never presented as verification of a file
we possess.

## If you want this source

CC BY-NC-ND is not waivable by us. It would need a **separate commercial licence
from Ubisoft La Forge**, which is a business decision and a procurement action,
not an engineering one. Until then the answer is no, and that is a licensing
fact rather than a technical limitation.
