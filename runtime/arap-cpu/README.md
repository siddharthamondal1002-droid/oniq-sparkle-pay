# ARAP CPU runtime

The zero-GPU character-motion stack, as a reproducible container image.

**Status, 2026-09-02: the build definition is complete and committed; the
image has NOT been built.** No docker daemon exists in the session that wrote
it, so `.github/workflows/arap-runtime-publish.yml` performs the build. Until
that workflow has run green there is no digest, no benchmark inside the
image, and nothing here is production-ready. What _has_ been proven, and
where, is listed under [What is proven](#what-is-proven) — and the same split
is recorded machine-readably in `pins.json` under `validation`.

## What this is for

`src/lib/arapProvider.ts` has been code-complete since 2026-08-22 and
unreachable ever since, because `makeArapL3Provider(null)` is what every
caller passes: with no CPU runner the provider is unavailable by
construction, selection drops it, and shots keep the still/parallax path.
This image is the missing runner — the provisioned host that the injected
`ArapCpuRunner` would execute.

It does **not** turn pose-warp on. `motionRuntime.ts` still passes
`allowPoseWarp: false`, and `.github/workflows/story-worker.yml` still runs
on a bare `ubuntu-latest` with no `container:`. Owner directive 2026-09-02
separated "build the artifact" from "change production" deliberately, and
`src/lib/__tests__/arapRuntimePins.test.ts` fails if the worker quietly grows
a `container:` — so wiring it up stays a decision somebody takes on purpose.

## Why an image, and not `actions/cache`

The stack is a source-built mmcv against a pinned torch, two mutually
incompatible numpy versions, and ~700 MB of model weights. A cache key
restores whatever an earlier run happened to leave behind and offers no way
to prove the contents match the pins. An image pinned by **digest** is the
same bytes every time, and every proof below runs before it is ever pushed.

## The two environments

They exist because the stack cannot be installed any other way.

|         | ENV A — `/opt/oniq/venv-autorig`                                   | ENV B — `/opt/oniq/venv-arap`                               |
| ------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| job     | drawing → rig                                                      | rig + BVH → moving pixels                                   |
| numpy   | **1.23.5** (OpenMMLab 1.x pins it hard)                            | **1.26.4** (AD's retarget uses `np.bool8`, gone in numpy 2) |
| torch   | 1.13.1+cpu                                                         | **none**                                                    |
| carries | mmcv-full 1.6.2 (source), mmdet 2.28.2, mmpose 0.29.0, onnxruntime | PyOpenGL/OSMesa, scipy, scikit-image, shapely               |

One interpreter (Python 3.10), two venvs. They communicate through the
**filesystem** — ENV A writes a character directory, ENV B reads it — never
through an import. `entrypoint.sh` deliberately puts no `python` on `PATH`,
so every command names the environment it belongs to.

## Using it

```
docker run --rm -v "$PWD:/work" <image@digest> rig     /work/still.png /work/char
docker run --rm -v "$PWD:/work" <image@digest> render  /work/char \
    /opt/oniq/AnimatedDrawings/examples/config/motion/zombie.yaml /work/clip.gif
docker run --rm                 <image@digest> proofs
```

The retarget config is fixed to the arm-damped one. It is the only setting
with a pixel proof behind it: graded damping is **falsified** for this driver
(the zombie walk's rest pose holds the arms across the torso, so every scale
level reproduces the claw/blade ARAP artifact). See `MOTION_AMPLITUDE.md`.

## What is proven

Measured in this container on 2026-09-02, natively on `/usr/bin/python3.10`,
because ENV B needs no blocked host and no docker daemon:

|            |                                                                          |
| ---------- | ------------------------------------------------------------------------ |
| render     | 779 frames, 500×500, headless OSMesa                                     |
| wall       | **72.6 s** (reproduced at 72.5 s on a second run, byte-identical output) |
| CPU        | 136.9 s user + 75.3 s sys                                                |
| peak RSS   | 1125 MB                                                                  |
| output     | 1,971,306 bytes, 211 GIF frames                                          |
| foreground | 0.1107 of frame (mean) — a real figure, not a blank or a smear           |
| motion     | inter-frame mean abs diff 1.579; **0 static frame pairs of 210**         |
| GL         | `3.3 (Core Profile) Mesa 25.1.7`, renderer `llvmpipe`                    |

So: OSMesa headless GL, the arm-damped retarget, the `zombie.bvh` WALKING
driver, the ARAP deform and the ENV B pin set all produce real, moving pixels
on CPU with no display and no GPU. `proofs/benchmark.py` and
`proofs/osmesa_render.py` were both run against that environment and pass;
they are not scripts written blind.

**Re-run as uid 65534 against a read-only checkout: 68.4 s, byte-identical
output.** This one matters more than it looks. `l3_animate_reference.py`
writes its assembled scene config _into_ the Animated Drawings directory and
`chdir`s there, so pointing the runner at a root-owned, write-stripped
`/opt/oniq` fails with `EACCES` on every render. `entrypoint.sh`'s `ad_view()`
builds a symlink farm: the directory is writable, every real file behind it is
not. The first attempt at this test ran as **root**, which ignores permission
bits — it passed while writing straight through a stale symlink back into the
read-only tree, and proved nothing. The non-root re-run is the evidence.

**Still PENDING, and not to be described otherwise:**

- **ENV A**, because `download.pytorch.org` answers `403 CONNECT` under this
  container's network policy (measured; it is a policy denial, not an
  upstream outage). It is an ordinary host from a GitHub Actions runner, so
  the build is CI's to do.
- **The image build**, because `/var/run/docker.sock` does not exist here.
- **The in-image benchmark**, which runs inside the built image.

## The torch pin is a gate, not a preference

Measured 2026-09-02: PyPI holds **no** CPU-only torch 1.13.1 for linux
x86_64. Its single manylinux wheel is `torch-1.13.1-cp310-cp310-manylinux1_x86_64.whl`
at 887,450,534 bytes — the CUDA 11.7 build. The `+cpu` local version exists
only on PyTorch's own index.

Because PyPI has no `+cpu` local version at all, it **cannot** satisfy
`torch==1.13.1+cpu`. Combined with `--index-url` (not `--extra-index-url`),
that means an unreachable PyTorch index stops the build with

```
BLOCKED: torch 1.13.1 CPU artifact unavailable from permitted source
```

rather than quietly baking an 887 MB CUDA torch into a CPU-only runtime.
Three separate assertions then check the installed result — version string,
`torch.version.cuda is None`, and the absence of any bundled CUDA library —
because a version string alone would not catch a substitution.

## Provenance

Every hash below was computed by streaming the asset through `sha256sum`.
None is quoted from memory, and `pins.json` is the machine-readable copy.

| asset                               | sha256                  | bytes       | licence                       |
| ----------------------------------- | ----------------------- | ----------- | ----------------------------- |
| `drawn_humanoid_detector.mar`       | `1a2654c8…33abfb`       | 327,104,441 | MIT                           |
| `drawn_humanoid_pose_estimator.mar` | `40ebdc69…6ee42f`       | 374,824,711 | MIT                           |
| `u2netp.onnx`                       | `309c8469…f4ddd8`       | 4,574,861   | rembg MIT / U²-Net Apache-2.0 |
| AnimatedDrawings                    | commit `b8596848…258f4` | —           | MIT                           |

The two `.mar` URLs were read out of Animated Drawings' **own**
`torchserve/Dockerfile` at the pinned commit rather than composed by hand;
the u2netp URL comes from the recorded setup block in
`remotion/scripts/segment_reference.py`. AD's repository has been archived
read-only since 2025-09, so the commit is stable. Licence terms are the ones
already recorded as VERIFIED in `OSS_MODEL_LICENSES.md`; the MIT text ships
inside the image beside the weights, because a product that redistributes
these weights needs the permission in the artifact, not only in a markdown
file.

`u2netp` is not optional. AD's classical threshold segmenter **failed on 6/6**
ONIQ painterly cast sheets (100% fill), and `arapProvider.ts` records
`mask: "rembg-u2netp"` for exactly that reason. `proofs/autorig_smoke.py`
fails a mask whose fill reaches 0.999, so that regression cannot ship
silently.

## Building it

```
docker build -f runtime/arap-cpu/Dockerfile --target models .
```

From the **repository root** — the image ships four reference scripts from
`remotion/scripts` and Docker cannot `COPY` above its context. The root
`.dockerignore` is deny-by-default and re-admits only those files, so the
context stays small and no stray `.env` can enter the build.

In CI: **arap runtime publish**, `workflow_dispatch` only, gated on typing
`PUBLISH-ARAP-CPU`. Never on push — the mmcv source build alone is tens of
minutes. It carries one credential, GitHub's own `GITHUB_TOKEN` for the GHCR
push; there is no other secret because every asset is a public, hash-pinned
download.

## Files

|                 |                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `pins.json`     | the single source of truth. Hashes, versions, provenance, and an honest `validation` block      |
| `Dockerfile`    | two stages: `base` (system + both venvs + AD checkout), `models` (weights, verified then baked) |
| `entrypoint.sh` | `rig` / `segment` / `render` / `proofs` / `benchmark` / `versions`                              |
| `proofs/`       | every check the publish workflow runs before pushing                                            |
