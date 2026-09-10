# §6 — eighteen algorithms

`src/oqca/quantum/algorithms.ts`: deutsch, deutsch_jozsa, bernstein_vazirani,
simon, grover, amplitude_amplification, qft, phase_estimation, shor,
quantum_walks, hamiltonian_simulation, quantum_simulation, vqe, qaoa,
quantum_annealing, qsp, qsvt, lcu.

Eleven required fields each. The two that make the file useful rather than
decorative are **`classicalAlternative`** and **`knownLimitations`** — §16
forbids calling a quantum method superior when the classical baseline was
denied equivalent information, and §18's discovery pipeline can only answer
"classical preferred" if every entry says what the classical option IS.

## No entry claims an advantage without naming its assumption

`complexity.caveat` is required and a test enforces a minimum length on it. The
oracle separations are the ones that need it most: Deutsch-Jozsa, Simon and
Bernstein-Vazirani are exponential ONLY in the query model against a
**deterministic** classical machine.

That is not a footnote. [15-method.md](15-method.md) measures it: given a coin,
a classical algorithm solves Deutsch-Jozsa in a number of queries that does not
grow with n at all. Bernstein-Vazirani's separation survives the same
treatment, and it is LINEAR.

## `applicability()` refuses in two different ways

```
noiseSensitivity extreme && !faultTolerant  -> "not applicable: needs fault tolerance"
!locallySimulable && availableQubits < 50   -> "not applicable: beyond both"
caveat says NO ADVANTAGE                    -> "classical preferred"
otherwise                                    -> "quantum candidate"
```

Shor is refused at 14 qubits and stops being refused at 4096 with fault
tolerance assumed — asserted both ways, so the function is not a constant.
