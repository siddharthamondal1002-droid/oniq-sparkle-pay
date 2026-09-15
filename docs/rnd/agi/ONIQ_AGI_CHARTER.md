# ONIQ AGI Research Charter

**Version:** 0.1  
**Effective:** 2026-09-15 IST  
**Decision:** `MODIFY`

## Mission

Advance ONIQ toward measurably broader reasoning, planning, research, coding,
tool use, multimodal understanding, memory, adaptation, self-evaluation, error
recovery, safety, and cost efficiency. AGI is a research objective, never a
product claim. Architecture, feature count, or a benchmark headline cannot by
itself establish general intelligence.

## Research Standard

Every capability claim requires a versioned task, held-out cases where
possible, an explicit baseline, acceptance and rejection criteria, environment
and model identity, a complete cost/latency record, reproducible evidence, and
failure analysis. Results from authored fixtures qualify harness mechanics only.

Material conclusions use four labels:

- **Observed:** supported directly by repository or executed evidence.
- **Inferred:** a reasonable interpretation that is not directly proven.
- **Unknown:** evidence is missing or inaccessible.
- **Proposed:** a recommendation, not current behavior.

## Capability Ladder

- **AGI-0 - Assistant:** answers and generates content.
- **AGI-1 - Grounded Assistant:** retrieves evidence, uses ONIQ context, and
  recognizes uncertainty.
- **AGI-2 - Tool User:** selects and safely operates authorized tools.
- **AGI-3 - Agent:** plans and completes bounded multi-step objectives.
- **AGI-4 - Adaptive Agent:** learns approved strategies and transfers them to
  unfamiliar variations.
- **AGI-5 - General Problem Solver:** reliable transfer across substantially
  different unfamiliar domains.
- **AGI-X - AGI Candidate:** reserved for a separately approved, demanding AGI
  evaluation protocol.

The highest fully supported stage is assigned. A stage is not inferred from the
existence of code paths associated with later stages.

## Governance

The product owner approves paid inference, credentials, private data, red-team
scope, production changes, and deployment. The research lead owns experiment
design and reporting. A reviewer independent of implementation challenges
leakage, unsupported claims, benchmark gaming, safety, and cost.

In the target architecture, an externally enforced Safety Kernel owns identity,
scopes, data classification, budgets, rate and retry limits, approval records,
audit, and shutdown. An agent may not modify those controls or grant itself
authority.

## Current Position

At repository commit `042dc46c0e94c97214377fd691df523b22e10519`,
the strict measured stage is **UNDETERMINED**. AGI-0 implementation paths are
present, but no live answer-generation behavior was run in this sprint. Code
supports a plausible AGI-1 architecture hypothesis, but no sealed live-system
benchmark establishes its grounding reliability. AGI-2 and above fail their
evidence gates.

The program decision is `MODIFY`: reuse the strong existing components, repair
known evidence and evaluation defects, then run the smallest sealed real-system
experiment. See `INTELLIGENCE_BASELINE.md` and `AGI_BENCHMARK.md`.
