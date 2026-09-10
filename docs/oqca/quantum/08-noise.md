# §9 — noise and error models

`src/oqca/quantum/math/channel.ts`. Nine channels, each with Kraus operators.

## Every one is proven CPTP, computationally

`isTracePreserving` sums `K†K` and compares to I. `isCPTP` builds the Choi
matrix and checks it is positive semidefinite. Both run over every channel in
the test, not a sample.

The limits are asserted because they are where a sign error hides:

```
depolarizing(1)      -> exactly the maximally mixed state
depolarizing(0)      -> exactly the identity
amplitudeDamping(1)  -> collapses |1> to |0>          (T1: energy)
phaseDamping(1)      -> population UNCHANGED           (T2: coherence only)
coherentError(U)     -> purity 1, entropy 0            (unitary, reversible)
```

The amplitude/phase pair is the one worth checking: a test that expected phase
damping to move population would be conflating T1 with T2.

## Readout noise is classical and stays its own type

A confusion matrix on the OUTCOME, not a channel on the state. Modelling it as
a bit flip before measurement gives the same marginals for a single shot and
the WRONG answer for anything conditioned on the state afterwards.

## The convention that differs by 4/3

ONIQ: `E(ρ) = (1−p)ρ + p·I/2`, so p=1 is exactly maximally mixed.
Qiskit Aer and Cirq: the Pauli form `(1−p)ρ + (p/3)(XρX + YρY + ZρZ)`, where
p=1 is **not** maximally mixed.

`p_pauli = (3/4)·p_oniq`. Quoting an error rate without saying which convention
is an unusable number. Recorded in `DIVERGENCES` and ingested as CONTESTED.

## What is not built

No device calibration data — no T1, T2 or per-gate error rate for any real
backend. No crosstalk and no correlated noise: every channel here acts on one
qubit independently. **No error mitigation**: zero-noise extrapolation and
probabilistic error cancellation are Mitiq's subject, Mitiq is GPL-3.0, and
nothing was taken from it.
