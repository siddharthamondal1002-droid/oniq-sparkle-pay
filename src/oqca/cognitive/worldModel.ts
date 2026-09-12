/**
 * THE WORLD MODEL — entities, what is believed about them, and why. §4.
 *
 * An entity is a thing ONIQ can hold a belief about (`story_dispatch`,
 * `github`, a job row). A FACT is one claim about one entity's one attribute,
 * carrying its own epistemic state and its own evidence. Facts are never
 * merged across epistemic states: an INFERRED status and an OBSERVED one about
 * the same attribute are two facts, and the reader can see both.
 *
 * WHY FACTS RATHER THAN FIELDS. A plain `{status: "failed"}` cannot record
 * that the status was GUESSED, and once written nobody downstream can tell.
 * That is the failure §4 exists to prevent, so the shape refuses it.
 */
import { type Epistemic, type Provenance, type Standing, promote } from "./provenance.ts";

export type Fact = {
  readonly entity: string;
  readonly attribute: string;
  readonly value: string;
  readonly epistemic: Epistemic;
  readonly supporting: readonly Provenance[];
  readonly contradicting: readonly Provenance[];
  readonly at: string;
};

/** A directed dependency: `from` needs `to` in order to work. */
export type Dependency = {
  readonly from: string;
  readonly to: string;
  readonly kind: "credential" | "service" | "code" | "quota" | "input" | "storage";
};

export type WorldModel = {
  readonly facts: readonly Fact[];
  readonly dependencies: readonly Dependency[];
};

export const EMPTY_WORLD: WorldModel = { facts: [], dependencies: [] };

export function factKey(f: Pick<Fact, "entity" | "attribute" | "epistemic">): string {
  return `${f.entity}|${f.attribute}|${f.epistemic}`;
}

/** What the evidence currently supports for this fact. §11. */
export function standingOf(f: Fact): Standing {
  return promote(f.supporting, f.contradicting);
}

/**
 * RECORD A FACT. A fact with the same entity+attribute+EPISTEMIC replaces its
 * predecessor and inherits nothing; a fact at a different epistemic state sits
 * BESIDE it. That is "never mix these states" made structural rather than
 * promised in a comment.
 */
export function observe(world: WorldModel, fact: Fact): WorldModel {
  const key = factKey(fact);
  const kept = world.facts.filter((f) => factKey(f) !== key);
  return { ...world, facts: [...kept, fact] };
}

export function declareDependency(world: WorldModel, dep: Dependency): WorldModel {
  const exists = world.dependencies.some(
    (d) => d.from === dep.from && d.to === dep.to && d.kind === dep.kind,
  );
  return exists ? world : { ...world, dependencies: [...world.dependencies, dep] };
}

/** Everything `entity` needs in order to work. The hypothesis space. §9. */
export function dependenciesOf(world: WorldModel, entity: string): readonly Dependency[] {
  return world.dependencies.filter((d) => d.from === entity);
}

export function factsAbout(world: WorldModel, entity: string): readonly Fact[] {
  return world.facts.filter((f) => f.entity === entity);
}

/** Entities carrying at least one fact or edge — the world's vocabulary. */
export function entities(world: WorldModel): readonly string[] {
  const s = new Set<string>();
  for (const f of world.facts) s.add(f.entity);
  for (const d of world.dependencies) {
    s.add(d.from);
    s.add(d.to);
  }
  return [...s].sort();
}
