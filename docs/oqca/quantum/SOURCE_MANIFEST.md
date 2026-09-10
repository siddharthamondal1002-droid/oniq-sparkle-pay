# What is reachable from this container, measured

Two files' comments point here — `provenance.ts` and
`quantum-harvest-sources.mjs` — because the whole `Directness` type turns on
this question. A claim labelled `fetched` when nothing was fetched is the
inflation the type exists to prevent, so what CAN be fetched has to be a
measured fact rather than an assumption.

## Reachable

| Host                         | What it answers                                         | Used for                                                |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| `pypi.org`                   | `/pypi/<package>/json` — version, licence, project URLs | the entire source manifest; evidence labelled `fetched` |
| `cloud.google.com/*/pricing` | list prices                                             | the health work's `[PAGE]` labels, not this tree        |

## Not reachable — measured, so nobody retries them

| Host                        | What was wanted                                 | What happens                                  |
| --------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `jena.apache.org`           | the Jena adapter's real API                     | proxy refusal                                 |
| `w3.org`                    | PROV-O and SHACL, for the provenance vocabulary | proxy refusal                                 |
| `api.github.com`            | repository READMEs and tests as evidence        | proxy refusal                                 |
| every ecosystem's docs host | the conventions in `DIVERGENCES`                | not attempted for evidence; cited, never read |
| `docs.cloud.google.com`     | Google's own pages                              | proxy refusal (recorded 2026-09-08)           |

## The consequence, and it is the point

**Every ecosystem convention in this tree is `spec_cited`, never `fetched`.**
`spec_cited` carries weight 0.5 against `fetched`'s 1.0, so a single cited
convention cannot reach the promotion threshold on its own — which is correct,
because nobody here has read the page.

That is also why the `DIVERGENCES` records come out **CONTESTED** rather than
resolved: ONIQ's own computed convention is first-hand evidence, the ecosystem's
is a citation, and §23 forbids picking a winner between two correct conventions
anyway.

**The PROV vocabulary in `provenance.ts` is therefore a shape written from
training, not a reading of the W3C recommendation.** Ten steps, four required.
It is honest about being ONIQ's own structure rather than a standard it claims
conformance with — and if conformance is ever wanted, the spec has to be read
first, from a machine that can reach `w3.org`.
