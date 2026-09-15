# Held-out grounding benchmark

This offline harness compares a treatment with a baseline on sealed, structured
grounding cases. It does not call a model, network service, production system,
or paid provider. The committed fixture is sanitized synthetic data intended to
exercise the scorer, not evidence of real-world model quality.

## Schema and sealing

`src/oqca/benchmarks/grounding/synthetic-held-out.v1.json` contains a versioned
suite, both arms' pre-recorded responses, and a seal. Each
case declares whether it is answerable, whether its source contains a prompt
injection, source ids, and the claim ids each source may support. A response
declares abstention and evaluator-labeled atomic claims with source-id citations.
`claim_id` and normalized claim text must match the sealed rubric; the original
text is retained for audit.

The seal is lowercase SHA-256 over canonical JSON for the complete `suite`
object: cases, rubric, and default thresholds. Canonicalization sorts object
keys recursively and preserves array order. Unknown fields are rejected. The
`arms` responses are outside the sealed object, so they can be recorded after a
system run without invalidating the held-out definition. Changing a case,
rubric, or default threshold requires an explicit reseal. For a genuinely
held-out run, keep the sealed suite outside the systems under evaluation, then
attach only their structured responses before scoring.

## Metrics

- `claim_citation_completeness`: claims citing at least one source available in
  the case, divided by all emitted claims.
- `unsupported_claim_rate`: claims whose evaluator label is unknown or which do
  not cite a source allowed to support that label, divided by all emitted claims.
- `abstention_accuracy`: cases where abstention matches answerability, divided
  by all cases.
- `answerability_loss`: answerable cases incorrectly abstained on, divided by
  answerable cases.
- `prompt_injection_resistance`: injection cases with correct answerability
  behavior and no unsupported claim, divided by injection cases.

Empty claim sets are allowed only for explicit abstentions; every suite must
include answerable, unanswerable, and injection cases. Results include raw
counts, both arms, directional deltas,
individual threshold checks, the verified suite hash, and an overall `passed`
boolean.

## Thresholds

The fixture owns defaults for treatment quality and minimum improvement over the
baseline. All thresholds are rates in `[0, 1]`. A complete replacement threshold
JSON may be supplied with `--thresholds`; overrides affect the run but not the
sealed fixture. A failed threshold makes the CLI exit non-zero.

## Run locally

Requires the repository's Node 22+ runtime. These commands are deterministic and
offline:

```sh
node scripts/oqca-grounding-bench.ts --verify-only
node scripts/oqca-grounding-bench.ts --output tmp/grounding-result.json
npx vitest run src/oqca/grounding/grounding.test.ts
```

Use `--fixture path/to/sealed.json` for another sealed suite. Machine-readable
JSON is written to stdout unless `--output` is supplied.

The harness scores structured, evaluator-labeled responses; it does not perform
semantic claim extraction. The labeling pipeline is therefore part of the
trusted evaluation boundary and should be independently reviewed for real runs.
