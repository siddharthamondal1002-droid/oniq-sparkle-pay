# ONIQ Quantum Knowledge Substrate

**One domain adapter under the general ONIQ Knowledge Substrate**, not a
parallel structure. That is the upgradation spec's §15 and it is the single
decision the whole tree is shaped by: quantum facts are `KnowledgeRecord`s and
go through the same promotion policy, the same conflict resolution and the same
decay rules as anything else ONIQ ever learns.

## Read this first

**ONIQ does not have "all quantum computing knowledge" and nothing here claims
it does.** §27 requires the report to say exactly which ecosystems, concepts,
algorithms and capabilities were incorporated and which remain outstanding.
That list is `docs/oqca/OQCA_QUANTUM_KNOWLEDGE_REPORT.md` §12, and it is
computed from the code rather than written down beside it.

Three things are true of every page here:

- **Nothing reaches a network.** `security.test.ts` walks `src/oqca/**` and
  finds no `fetch`, no credential and no clock. `DEFAULT_QUANTUM_POLICY` ships
  `remoteQuantumExecution: false` and `maxQuantumCostUsd: 0`, and `QPUBackend`
  refuses on the policy before it looks at anything else.
- **No source code was copied.** §2 prefers independently authored ONIQ
  representations, and that is what these modules are. Mitiq is the only
  copyleft source in the manifest (GPL-3.0) and nothing was taken from it.
- **Prose is not belief.** The 27 concept definitions, 18 algorithm
  descriptions and 8 domain summaries were written from training with no
  document fetched, which makes them `recalled` — weight zero, unpromotable.
  They are ONIQ's _representation_, and they are deliberately NOT ingested as
  knowledge. See `01-sources.md`.

## The pages

| Page                                                   | Brief         | What it covers                                                                          |
| ------------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------- |
| [01-sources.md](01-sources.md)                         | §1, §2        | The 18 ecosystems, measured from PyPI; licences; what may be copied                     |
| [02-foundations.md](02-foundations.md)                 | §3            | The 27 mathematical objects, each with a counterexample                                 |
| [03-gates.md](03-gates.md)                             | §4            | The gate library and the invariants computed over it                                    |
| [04-circuits.md](04-circuits.md)                       | §5            | Circuit model, metrics, embedding                                                       |
| [05-algorithms.md](05-algorithms.md)                   | §6            | 18 algorithms, each naming its classical alternative                                    |
| [06-qml.md](06-qml.md)                                 | §7            | Quantum machine learning, and why no advantage is stored                                |
| [07-information-theory.md](07-information-theory.md)   | §8            | Entropy, entanglement, distance, fidelity                                               |
| [08-noise.md](08-noise.md)                             | §9            | Channels, Kraus operators, the CPTP checks                                              |
| [09-error-correction.md](09-error-correction.md)       | §10           | QEC — represented and NOT implemented                                                   |
| [10-compilation.md](10-compilation.md)                 | §11           | Transpilation, routing, synthesis                                                       |
| [11-zx-calculus.md](11-zx-calculus.md)                 | §12           | ZX — represented and NOT implemented                                                    |
| [12-tensor-networks.md](12-tensor-networks.md)         | §13           | MPS, bond dimension, contraction                                                        |
| [13-chemistry.md](13-chemistry.md)                     | §14           | Second quantisation, fermion maps, VQE                                                  |
| [14-backends-and-policy.md](14-backends-and-policy.md) | §15, §21      | The six-method interface, 15 refusing adapters, the security defaults                   |
| [15-method.md](15-method.md)                           | §16, §17, §18 | Fair baselines, the experiments, the discovery pipeline                                 |
| [16-boundary.md](16-boundary.md)                       | §20, §23      | The three categories, and the disagreements kept rather than normalised                 |
| [SOURCE_MANIFEST.md](SOURCE_MANIFEST.md)               | §1, §9        | What is reachable from this container, and why every ecosystem convention is a citation |

## Where the code is

```
src/oqca/quantum/
  math/{linalg,state,info,channel}.ts   the floor: complex matrices upward
  gates.ts        19 gates, every invariant computed
  circuit.ts      the §5 circuit model and its metrics
  backends/       the six-method interface, the local simulator, 15 refusals
  policy.ts       §21's defaults, which refuse
  concepts.ts     §3
  algorithms.ts   §6
  domains.ts      §7-§14 as structured knowledge, plus DIVERGENCES (§23)
  sources.ts      §1, harvested
  boundary.ts     §20
  experiments.ts  §16, §17
  discovery.ts    §18
  knowledge.ts    §22/§25 — the adapter into the OKS

src/oqca/knowledge/substrate/          the GENERAL substrate the above sits under
  {record,evidence,provenance,promotion,conflict,decay,store,project,metrics}.ts
```
