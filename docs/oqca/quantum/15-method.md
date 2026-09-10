# §16, §17, §18 — fair baselines, experiments, discovery

## §16's sentence is the whole design

> **"The system must never call a quantum method superior merely because the
> classical baseline was denied equivalent information."**

That is not a caution. It is the most common way a quantum claim goes wrong, and
here it is a REFUSAL. Every experiment names its classical baseline; every
baseline declares what information it was given on four axes — randomness,
bounded error, the same oracle, the same promise — and `fairnessCheck` returns
every axis on which the baseline was short-changed.

An unfair run still REPORTS its numbers. Hiding the comparison would hide the
thing §16 exists to expose; what is refused is the VERDICT.

## The result, measured on the local simulator for $0

Four runnable experiments, and two of them disagree with each other on exactly
this axis:

```
dj_unfair    quantum 1 vs classical 5     baseline denied randomness AND
                                          bounded error -> NOT a fair separation
dj_fair      quantum 1 (exact)            classical 6 queries at measured
                                          error 0.0050 <= 0.01
dj_scaling   deterministic  5 -> 1025     over n = 4..12  (doubling per qubit)
             randomised     6 -> 8        FLAT
bv_fair      quantum 1, recovered 1011    classical 4, and randomness does not
                                          help: n bits of answer need n bits
```

**Deutsch-Jozsa's exponential separation is a fact about the classical machine
being denied a coin, not about the problem.** Bernstein-Vazirani's survives the
same treatment and is LINEAR. Same textbook chapter, same circuit shape,
opposite conclusions once the baseline is treated fairly.

`grover_scaling` is registered and **blocked**, with the reason named: the
closed gate registry carries no arbitrary-width multi-controlled Z for the
diffuser.

## Matching the error before comparing the cost

The quantum circuit is EXACT. Quoting it against a classical run allowed 20%
error would be the §16 cheat pointing the other way, so
`classicalDjQueriesFor` scans upward for the k whose MEASURED error meets
`TARGET_ERROR = 0.01`, and that is the number reported.

## `establishes` — fairness is not a verdict

An experiment declares what it is entitled to conclude: `advantage`,
`no_advantage` or `cost_only`. `establishmentAgrees` checks the declaration
against the numbers by re-running the classical side across `QUBIT_SWEEP` and
reading the **tail**: strictly increasing over the last three points means the
cost grows with n; otherwise it is bounded.

`last > first` is NOT that test and was the first version: DJ's 6,7,8,8,8 is a
saturating curve and `8 > 6` read it as growth.

## §18 — discovery, whose most common correct answer is "classical"

`discover(problem)` maps a problem's STRUCTURE (a closed list, never a keyword
search over prose) to candidate algorithms and returns one of four answers:

| Answer                  | Meaning                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `classical`             | candidates match, no FAIR experiment supports an advantage      |
| `quantum_candidate`     | a fair `advantage` experiment supports one, and it is simulable |
| `not_executable_here`   | matches, but beyond 14 qubits with remote off                   |
| `no_matching_structure` | no quantum algorithm addresses this shape                       |

**Executability and advantage are separate answers**, because the fixes differ:
one needs hardware the owner has not authorised, the other needs a better idea.

Run against the problems ONIQ actually has:

```
story_dispatch    no_matching_structure
health_extraction no_matching_structure
shot_allocation   classical      (qaoa, quantum_annealing match; nothing supports them)
vault_retrieval   classical      (grover matches; and the Study Vault is INDEXED
                                  FTS, so it is not unstructured search anyway)
```

That IS the §18 result for this codebase — not a placeholder. A pipeline that
could not return "classical" would be a recommendation engine for quantum
computing rather than a decision procedure.
