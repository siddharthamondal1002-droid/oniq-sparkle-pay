# §10 — quantum error correction

**Represented. Not implemented. Nothing here corrects anything.**

That is the honest state and it is what `DOMAINS.qec.implementedHere = []`
records; `coverage()` computes `knowledgeOnly: ["qec", "zx"]` from it, and a
test asserts exactly those two.

## What is represented

Stabilizer groups, syndrome extraction, code distance, the surface code and the
threshold theorem, each with the constraint that makes it usable:

- stabilizer generators must **commute pairwise**, or the syndrome is not
  simultaneously measurable;
- a syndrome must reveal **nothing** about the logical state, or it collapses
  it;
- correcting an error and applying a logical operator are indistinguishable
  from the syndrome alone — the decoder chooses a coset representative;
- an `[[n,k,d]]` code corrects `⌊(d−1)/2⌋` arbitrary single-qubit errors, so a
  distance-3 code **detects** two and **corrects** one.

## Why nothing is built

The state vector here is a flat 2ⁿ amplitude list with no factorisation, so
**there is no code space to project onto** — the same structural reason
`cognitive.entangle` is a category-C operation ONIQ refuses by name.

Simulating a surface code on a state vector is not merely slow, it is the wrong
representation: stabilizer simulation is polynomial and state vectors are
exponential. Stim is the right tool and was not vendored — it is a large C++
surface and its Python package is not a dependency ONIQ may add (`package.json`
is Lovable's, and every dependency is a paid round trip).

## The pitfall that matters most

A threshold is a property of a **code, a noise model and a decoder together**.
A threshold number quoted without all three is not comparable to any other
threshold number.
