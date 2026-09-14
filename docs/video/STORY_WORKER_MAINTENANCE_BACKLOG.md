# Story worker maintenance backlog

## Done in this branch

- confirm GitHub inspection access works from this task session
- record the failed run, current `main`, and checkout semantics
- add a read-only maintenance workflow that checks out `main`, writes records, and uploads them as an artifact

## Still required for final product acceptance

1. Observe exactly one post-fix, product-supported synthetic worker execution only if the existing authorization and budget path already permits it.
2. Prove the actual checked-out SHA for that execution, not only the workflow run head SHA.
3. Prove terminal successful job state.
4. Prove retrievable and playable output media.
5. Prove settled accounting for that execution.
6. Prove there was no duplicate execution and no duplicate charge.

## Constraints carried forward

- Do not treat green CI as product acceptance.
- Do not dispatch a synthetic worker run from this branch unless the existing authorization and budget path is already approved and measurable.
- Edge-function deploy, GitHub workflow state, and product rendering are separate facts and must be verified separately.
- If a future synthetic execution is attempted, capture its artifact identity, checked-out SHA, and settled ledger state in the same evidence bundle.
