# `transfer` — declared, and deliberately EMPTY

This directory holds no manifest, and that is a decision rather than an
oversight.

The v1.1 brief names six benchmark families. Three of them —
`contextuality`, `interference` and `hypothesis` — describe things the
current kernel can actually be asked to do, and each carries a manifest with a
matched classical control and an adversarial suite. **`transfer` does not.**

Writing a manifest here would mean inventing a task that the kernel cannot
genuinely fail, which is exactly what this repository's own record warns
against: every fixture that "proved" the UPI payload was invented in this
container, and it proved nothing. A benchmark that cannot lose is not a
benchmark.

What each of the three missing families would first need:

- **memory** — a state that persists across EPISODES, and something that
  decides what to carry forward. `CognitiveState` serialises and replays, so
  the substrate exists; what does not exist is any consolidation policy to
  test.
- **transfer** — learning. Nothing in OQCA fits parameters to data, so there is
  no learned thing that could transfer to a second task.
- **planning** — an action space and a world model that predicts consequences.
  `knowledge/planner.ts` ranks knowledge GAPS, which is a different and much
  smaller claim, and it is unit-tested rather than benchmarked because a
  ranking has no ground truth here.

Adding a manifest to this directory should come with the capability it tests,
in the same change.
