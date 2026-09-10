# §1, §2 — the source manifest, and what may be copied

## Measured, not remembered

`src/oqca/quantum/sources.ts` carries eighteen ecosystems, each with the
version and licence **PyPI returned on 2026-09-10T15:12:30Z**.
`scripts/quantum-harvest-sources.mjs` reproduces the harvest;
`HARVEST_ENDPOINT` records the URL that answered.

The brief said "Research current versions and official documentation before
implementation. Do not assume old APIs." The measurement is what that means
here, and it mattered: **Qiskit is at 2.5.2**, far past the 0.x/1.x APIs a
model recalls, so any code written from memory of `qiskit.execute` would have
been wrong before it was reviewed.

## Two harvested imperfections, pinned rather than tidied

- **Cirq publishes an `http://` repository URL.** Recorded as returned.
- **Three projects publish no repository or documentation URL at all** —
  `qualtran`, `pennylane`, `qulacs`. `locatorFor()` falls back to the PyPI
  project page, which is the address the harvest actually read them from and
  which the OKS spec's §9 names as an acceptable locator ("a URL, a file path,
  a registry endpoint"). Nothing is invented.

`quantumKnowledge.test.ts` pins both, in both directions, so a re-harvest that
changes them is noticed instead of absorbed.

## The licence answer

**Mitiq is the only copyleft source: GPL-3.0.** `COPYLEFT_SOURCE_IDS` names it
and a test asserts the list equals the set of GPL licences in the manifest, so
a new copyleft dependency cannot arrive unflagged.

**Nothing was copied from any of the eighteen.** §2 prefers independently
authored ONIQ representations and that is what every module in
`src/oqca/quantum/` is. Where a convention is taken from an ecosystem it is
recorded as a CITATION with `directness: "spec_cited"` — never as a reading,
because the documentation hosts are not reachable from this container and
labelling a citation as a fetch is the inflation the type system exists to
prevent.

## What "evidence" means for each kind of claim

| Claim                                      | Directness   | Extraction         | Promotes? |
| ------------------------------------------ | ------------ | ------------------ | --------- |
| A package's version / licence              | `fetched`    | `structured_field` | **yes**   |
| A gate is unitary                          | `derived`    | `computed`         | **yes**   |
| ONIQ implements domain X                   | `derived`    | `computed`         | **yes**   |
| An ecosystem's convention                  | `spec_cited` | `human_authored`   | no, alone |
| A concept definition written from training | `recalled`   | `human_authored`   | **never** |

The last row is why the 27 concept definitions, 18 algorithm descriptions and
8 domain summaries are **not ingested as knowledge**. `recalled` is weight
zero; a store full of unpromotable rows is a store nobody reads the status of,
and the fix that would "solve" it — relabelling recall as a citation — is
exactly the dishonesty the type exists to stop. The prose stays in
`concepts.ts`, `algorithms.ts` and `domains.ts` as ONIQ's representation, and
`NOT_INGESTED` says so in the code rather than only here.
