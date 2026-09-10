# §12 — ZX calculus

**Represented. Not implemented.** No diagram type, no rewrite engine, no
extraction.

## What is represented

Spiders (Z green, X red, each carrying a phase), spider fusion, Hadamard edges,
graph-like form with local complementation and pivoting, and completeness for
the stabilizer fragment.

The invariants that matter for anyone who builds it:

- a rewrite preserves the denotation **up to a scalar**, and scalars must be
  tracked or the final normalisation is wrong;
- colour change is conjugation by H, so every rule stated for Z has an X mirror;
- T-count reduction by phase-gadget resynthesis preserves the unitary, which is
  what makes it an optimisation and not an approximation.

## The hard half, named before anyone starts

**Circuit extraction from a simplified graph-like diagram is #P-hard in
general.** Simplifying is the easy half; getting a runnable circuit back out is
the one that decides whether the whole approach is usable. Recording that here
is worth more than a partial rewrite engine would be.

PyZX is the reference implementation and was not vendored; §2 prefers an
independently authored ONIQ representation and none has been written.

## Three pitfalls

- ZX is **not a simulator**. A diagram denotes a linear map and evaluating it is
  as hard as the map.
- Dropping scalars because "phase is unobservable" — global phase is
  unobservable, but a scalar factor changes the amplitude of a POSTSELECTED
  branch.
- Completeness is for the **stabilizer fragment** in the classic result, with
  later extensions. "ZX is complete" without the qualifier is wrong.
