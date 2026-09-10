# §14 — quantum chemistry and open systems

Represented. No chemistry package is built, and this file says what one would
have to hold.

## The pipeline

A molecular Hamiltonian in second quantisation → a fermion-to-qubit map
(Jordan-Wigner, or Bravyi-Kitaev for O(log n) operator weight) → ground-state
energy by VQE or phase estimation, with time evolution by Trotterisation.

## Four invariants, each of which is a bug when violated

- The fermionic map must preserve `{a_p, a_q†} = δ_pq`. A map that does not is
  not a fermionic encoding.
- **Particle number is conserved** by the electronic Hamiltonian, so a state
  leaving that sector is a bug and not a result.
- **The variational principle bounds from ABOVE.** A VQE energy is an upper
  bound on the ground state, so lower is better — and lower than exact means an
  error somewhere, never a discovery.
- Trotter error is a function of the **commutators** of the terms, not merely of
  the step count.

## What is implemented

`expectation`, `eigenvaluesHermitian`, `isHermitian`, `densityFromState` — which
diagonalise a matrix somebody else built. No Hamiltonian construction, no basis
set, no integrals, no fermionic operator type, no qubit mapping, no VQE and no
Trotter product formula. OpenFermion is the reference for the mapping layer and
was not vendored.

## The reporting pitfalls

- A VQE energy without the **basis set and active space** is not a number about
  a molecule. The same molecule at different bases is a different number and
  neither is "the" energy.
- Agreement with an exact diagonalisation of the SAME truncated Hamiltonian is
  agreement about the model, not chemical accuracy about the molecule.
- Jordan-Wigner term counts grow as O(n⁴), which is where the shot budget goes.
