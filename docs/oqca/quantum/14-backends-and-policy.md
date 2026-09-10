# §15, §21 — the backend interface and the security defaults

## Six methods, no escape hatch

`QuantumBackend` in `src/oqca/quantum/backends/backend.ts`:
`createState`, `applyOperation`, `measure`, `simulate`, `expectation`, `reset`.

No "run raw", no vendor-object passthrough, no options bag. §26 asks that every
backend pass common semantic tests, which is only possible if the interface is
narrow enough that two implementations can genuinely agree. An adapter needing
an escape hatch would be one whose results could not be compared with the local
simulator's, and comparison is the entire reason the interface exists.

Every method returns `BackendResult<T>` — `{ok: true, value}` or
`{ok: false, reason, detail}`. There is no throwing path, so a refusal is data
a caller must read rather than an exception it can swallow.

## The one real backend

`makeStatevectorBackend` — a full state-vector simulator, deterministic given a
seed (mulberry32), capped by `maxSimulatedQubits` (14) and `maxShots`
(100,000). It runs Bell states, GHZ states, non-adjacent CX, and the §17
experiments.

`reset` returns a **density matrix**, because reset is not unitary and the
honest return type says so.

## Fifteen adapters, all refusing

Qiskit, Aer, Cirq, qsim, Stim, Qualtran, ReCirq, OpenFermion, TFQ, PennyLane,
QuTiP, PyZX, tket, BQSKit, Mitiq, quimb, Qulacs — each an `AdapterSpec` naming
its capabilities, purpose and **limitations**, bound to a MEASURED source so its
refusal quotes the real version and licence. `makeUnavailableBackend` turns any
spec into a backend that refuses all six methods with that detail.

The refusal names Mitiq's copyleft explicitly: _"COPYLEFT — research use only,
never bundled."_

## §21's defaults, which refuse

```
remoteQuantumExecution   false
maxQuantumCostUsd        0
maxSimulatedQubits       14
maxShots                 100_000
```

`checkRemote` refuses **remote first, then cost** — and the order is the point.
A caller who flipped the flag without funding it is refused on COST, which
names the thing they still have to decide; a single combined check would say
"remote disabled" and send them to change the flag they already changed. Three
distinct reasons in a fixed order: `remote_execution_disabled`,
`cost_budget_zero`, `cost_budget_exceeded`.

`QPUBackend` refuses on the POLICY before it looks at anything else, so
enabling the flag alone does not create a vendor — there is none, no
credential, and no queue.

`security.test.ts` walks the whole tree and finds no `fetch`, no
`XMLHttpRequest`, no `WebSocket`, no credential name and no clock. Two files
are exempt from the URL ban only — `sources.ts` and `knowledge.ts`, which carry
provenance LOCATORS — and every other ban still applies to them, asserted
file by file.
