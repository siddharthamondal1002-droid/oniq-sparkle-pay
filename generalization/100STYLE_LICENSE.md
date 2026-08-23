# 100STYLE — licence status

## `LICENCE = NOT_VERIFIED_FROM_THE_AUTHORITATIVE_SOURCE`

This is **not** a finding that 100STYLE is unsuitable. It is a finding that **I
could not read the licence**, which under the loop's own fail-closed rule is a
stop condition rather than a maybe.

## What the gate required

> Verify directly from the authoritative 100STYLE source: CC BY 4.0 […]
> Do NOT infer data rights from a GitHub code licence. The 100STYLE source
> itself must establish the data licence.

Every host that could carry that statement is refused by this environment's
network egress policy at the CONNECT stage:

| authoritative host | result | proxy record (2026-08-23) |
|---|---|---|
| `ianxmason.github.io` — project page | unreachable | `connect_rejected` 403, 15:08:02.920Z |
| `www.ianxmason.com` — author's own domain | unreachable | `connect_rejected` 403, 15:08:03.209Z |
| `zenodo.org` — record 8127870, licence metadata + data | unreachable | `connect_rejected` 403, 15:08:03.463Z |
| `datashare.ed.ac.uk` — alternate host | unreachable | `connect_rejected` 403, 15:08:03.702Z |
| `doi.org` — DOI resolution | unreachable | `connect_rejected` 403, 15:08:03.957Z |
| `web.archive.org` — archived copy | unreachable | `connect_rejected` 403, 15:08:04.704Z |
| `github.com` | 403 | — |
| `arxiv.org` — the paper | unreachable | — |

**Control, fetched in the same batch:**
`raw.githubusercontent.com/orangeduck/100style-retarget/master/README.md` → **HTTP 200**.
The session's network works. These are policy denials, not failures.

## What I did find — corroboration, graded honestly

`orangeduck/100style-retarget` is a **third-party redistribution** of the
dataset. It is reachable, and it carries:

- `LICENSE.txt` — **HTTP 200**, 18,650 bytes, sha256
  `7e7170e3cebf88a9f60c7b8421418323c09304da1af4d5e90f4da1dc1c8a2661`, first
  line **"Attribution 4.0 International"**. The full CC BY 4.0 legal code, with
  **zero** occurrences of `NonCommercial` or `NoDerivatives`.
- `README.md` — **HTTP 200**, sha256 `2984bf5f…`, stating verbatim: *"This
  version of the data is licensed under the same terms as the original dataset
  which is Creative Commons Attribution 4.0 International."*
- The required academic citation (Mason, Starke & Komura 2022,
  doi `10.1145/3522618`).

**This does not pass the gate, and I am not treating it as if it did.** A
redistributor restating an upstream licence is a stronger signal than a search
snippet — it is a licence notice that CC BY 4.0 itself obliges a redistributor
to carry — but it is still not the upstream author's own statement, and the
directive drew that line explicitly. Corroboration, nothing more.

The same reasoning that rejected PyMO last route applies here in the owner's
favour rather than against it: **a repository's licence file speaks for what
that repository distributes.** For PyMO the data had no stated licence at all;
here the redistributor does state one and names its upstream. That difference is
real, and it is still not enough to substitute for the source.

## What was NOT done

- The `100style-retarget` BVH export was **not** used as a substitute. It is
  retargeted onto a different skeleton (so not the unedited 28-bone source),
  it carries an upstream motion-editing step that would break the
  representation-preservation guarantee before ONIQ's adapter starts, its
  SHA-256 could not be checked against any official file, and it ships the Geno
  character the directive excludes. Its host is blocked in any case.
- No repository path was guessed to route around a 404. Four search-derived
  repository paths were each tried once at the two default branch names and
  then dropped.
- No PyPI or mirror route was attempted — that route is CLOSED by prior owner
  directive and was not retried.

## Attribution, recorded for when the gate does open

If and when the licence is confirmed from the authoritative source, the
attribution CC BY 4.0 requires is the dataset, its authors, the licence, and —
as the dataset itself requests for academic use — the citation:

```
Mason, Ian; Starke, Sebastian; Komura, Taku.
"Real-Time Style Modelling of Human Locomotion via Feature-Wise Transformations
and Local Motion Phases."
Proceedings of the ACM on Computer Graphics and Interactive Techniques,
5(1), Article 6, May 2022. doi:10.1145/3522618
```

This text is recorded **as unverified against the authoritative source** — it
comes from the redistributor's README, not from Ian Mason's own page.

## What unblocks it

One environment network-policy allowance: **`zenodo.org`** and
**`ianxmason.github.io`** (or `www.ianxmason.com` / `datashare.ed.ac.uk`).
That is a decision about the environment, not an engineering problem — with
those hosts reachable the licence gate and the download gate both resolve in
minutes.

The alternative needs no network change at all: **attach the selected
`<Style>_FW.bvh` to the session directly.**
