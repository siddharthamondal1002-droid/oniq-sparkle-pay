# §7 — quantum machine learning

`DOMAINS.qml` in `src/oqca/quantum/domains.ts`.

## The rule this section is really about

> **"Never store 'quantum advantage' as a fact unless supported by a specific
> benchmark."**

Enforced as a REFUSAL, not a convention. `assertAdvantage()` in `knowledge.ts`
is the only way a positive advantage record can be created and it **throws**
without a named benchmark. The ordinary ingestion path therefore produces
**eighteen negative records and zero positive ones** — one per algorithm,
saying `hasDemonstratedAdvantage: false` — because no benchmark has been run
here. `advantageClaims` is empty on every domain, and a test requires any entry
to carry a benchmark and its limits.

## What is represented

Parameterised circuits, data encodings (angle / amplitude / basis), quantum
kernels, the parameter-shift rule and barren plateaus, each with the constraint
that makes it usable — the parameter-shift rule is exact only for gates whose
generator has two distinct eigenvalues; a kernel is a PSD Gram matrix up to
sampling error; the gradient carries shot noise of order 1/√shots.

## What is not built

**No optimiser, no training loop, no autodiff, no dataset, no benchmark
harness, and therefore no measured QML result of any kind.** The
parameter-shift rule is described and not coded. No barren-plateau diagnostic:
the variance scaling is stated, not measured.

## The pitfalls worth carrying

- Reporting a training-set fit as an advantage. §16 requires the classical
  baseline to see the same data and the same feature map, which most published
  comparisons do not do.
- Amplitude encoding looks cheap in qubits and is expensive in DEPTH. The
  state-preparation circuit IS the cost and is usually left out of the quote.
- A simulator's exact expectation is not what hardware returns. A QML result
  with no shot noise is a result about linear algebra.
