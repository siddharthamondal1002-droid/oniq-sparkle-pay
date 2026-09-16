# E-003A Measurement-Integrity Gate

This directory contains integrity machinery, not a scored capability suite. It
therefore has no task manifest and produces no intelligence score.

E-003A qualifies whether later E-003B runner, evaluator, and output artifacts
are bound to the same repository revision, environment, dependencies, adapter,
prompt, tool catalog, sealed task manifest, thresholds, and evaluator.

## Custody

The evaluation custodian signs the runner and evaluator bindings with Ed25519
before execution. The post-run output binding names the SHA-256 digests of those
two frozen bindings and the output bundle. Verification accepts only configured
custodian public keys. Private keys, hidden tasks, and expected outputs must
never be available to the runner or committed here.

Use:

```text
npm run bench:e003a:verify -- --runner RUNNER.json --evaluator EVALUATOR.json \
  --output OUTPUT.json --trusted-keys TRUSTED_KEYS.json
```

The command verifies signatures and cross-artifact bindings. It does not run a
model, invoke a tool, authorize spend, or judge task success.

## Acceptance

The normal repository checks must pass. The focused E-003A mutation workflow
must also show that M163-M166 are caught: permission-surface replay,
record-count provenance, blocked-experiment regression denial, and artifact-body
tampering.

Passing E-003A qualifies the measurement apparatus only. It does not change the
ONIQ capability stage, authorize E-003B, establish agent improvement, or permit
production deployment.
