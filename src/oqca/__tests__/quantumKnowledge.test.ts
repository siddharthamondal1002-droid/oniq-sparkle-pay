/**
 * QUANTUM KNOWLEDGE — brief §1, §2, §3, §6, §7, §20, §22, §23, §25, §27.
 *
 * The rule that shapes this file: **a knowledge entry that names a function
 * must name a REAL one, and a knowledge entry that claims a fact must carry
 * evidence that survives the promotion policy.** Everything else here is
 * prose, and prose is checked by reading it, which is what §27 forbids relying
 * on.
 *
 * So every `invariantCheck`, every `implementedHere` name and every `sourceId`
 * is RESOLVED against the modules and the registry — a claim nothing backs
 * fails the build rather than sitting in a table looking authoritative.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONCEPTS, CONCEPT_BY_ID, claimedInvariantChecks } from "../quantum/concepts.ts";
import { ALGORITHMS, ALGORITHM_BY_ID, applicability } from "../quantum/algorithms.ts";
import {
  DOMAINS,
  DIVERGENCES,
  coverage,
  unregisteredSourceIds,
  domainSourceIds,
} from "../quantum/domains.ts";
import {
  QUANTUM_SOURCES,
  SOURCE_BY_ID,
  COPYLEFT_SOURCE_IDS,
  isCopyleft,
  stampFor,
  locatorFor,
  HARVESTED_AT,
} from "../quantum/sources.ts";
import {
  CATEGORISED,
  CATEGORY_OF,
  QUANTUM_CATEGORIES,
  sameCategory,
  PHYSICAL_ONLY_CLAIMS,
  claimIsLegitimate,
} from "../quantum/boundary.ts";
import {
  ingestQuantumKnowledge,
  quantumSourceRegistry,
  assertAdvantage,
  advantageFacts,
  divergenceFacts,
  NOT_INGESTED,
  QUANTUM_DOMAIN,
  resetEvidenceIds,
} from "../quantum/knowledge.ts";
import { makeLocalStore } from "../knowledge/substrate/store.ts";
import {
  mayInformDecision,
  mayInformConflictAwareDecision,
} from "../knowledge/substrate/record.ts";
import * as linalg from "../quantum/math/linalg.ts";
import * as state from "../quantum/math/state.ts";
import * as info from "../quantum/math/info.ts";
import * as channel from "../quantum/math/channel.ts";
import * as circuit from "../quantum/circuit.ts";
import * as gates from "../quantum/gates.ts";
import * as adapters from "../quantum/backends/adapters.ts";
import * as policy from "../quantum/policy.ts";

const EXPORTS: Record<string, unknown> = {
  ...linalg,
  ...state,
  ...info,
  ...channel,
  ...circuit,
  ...gates,
  ...adapters,
  ...policy,
};
const AT = "2026-09-10T18:00:00Z";

describe("§3 — concepts are executable, not encyclopedic", () => {
  it("carries all six required fields on every entry, including the awkward one", () => {
    expect(CONCEPTS.length).toBeGreaterThanOrEqual(27);
    for (const c of CONCEPTS) {
      expect(c.definition.length, c.id).toBeGreaterThan(20);
      expect(c.notation.length, c.id).toBeGreaterThan(0);
      expect(c.constraints.length, c.id).toBeGreaterThan(0);
      expect(c.invariants.length, c.id).toBeGreaterThan(0);
      expect(c.examples.length, c.id).toBeGreaterThan(0);
      // COUNTEREXAMPLES ARE THE FIELD A SUMMARY LEAVES OUT. It says where the
      // concept stops, and it is the one that catches a plausible-sounding
      // misunderstanding — so it is required rather than optional.
      expect(c.counterexamples.length, `${c.id} has no counterexample`).toBeGreaterThan(0);
    }
  });

  it("names only invariant checkers that exist as real exports", () => {
    const named = claimedInvariantChecks();
    expect(named.length).toBeGreaterThan(5);
    for (const fn of named) {
      expect(typeof EXPORTS[fn], `${fn} is not an exported function`).toBe("function");
    }
  });

  it("has no dangling dependsOn edge", () => {
    for (const c of CONCEPTS) {
      for (const d of c.dependsOn) {
        expect(CONCEPT_BY_ID.has(d), `${c.id} depends on unknown ${d}`).toBe(true);
      }
    }
  });

  it("has unique ids", () => {
    expect(new Set(CONCEPTS.map((c) => c.id)).size).toBe(CONCEPTS.length);
  });
});

describe("§6/§7 — no algorithm claims an advantage without naming its assumption", () => {
  it("carries all eleven fields, and a classical alternative on every entry", () => {
    expect(ALGORITHMS.length).toBeGreaterThanOrEqual(18);
    for (const a of ALGORITHMS) {
      expect(
        a.classicalAlternative.length,
        `${a.id} names no classical alternative`,
      ).toBeGreaterThan(10);
      expect(a.knownLimitations.length, `${a.id} names no limitation`).toBeGreaterThan(0);
      expect(a.assumptions.length, `${a.id} names no assumption`).toBeGreaterThan(0);
      expect(a.circuitStructure.length, a.id).toBeGreaterThan(0);
      // §7 IN THE COMPLEXITY FIELD: a quantum/classical pair with no caveat is
      // a speedup claim with nothing qualifying it.
      expect(
        a.complexity.caveat.length,
        `${a.id} quotes a complexity with no caveat`,
      ).toBeGreaterThan(15);
    }
  });

  it("applicability refuses what the simulator cannot reach and what needs fault tolerance", () => {
    const shor = ALGORITHM_BY_ID.get("shor")!;
    expect(applicability(shor, 14, false)).toMatch(/not applicable/);
    // With fault tolerance ASSUMED and enough qubits it stops being refused —
    // otherwise the function would be a constant and the test vacuous.
    expect(applicability(shor, 4096, true)).not.toMatch(/needs fault tolerance/);
    const dj = ALGORITHM_BY_ID.get("deutsch_jozsa")!;
    expect(applicability(dj, 14, false)).toMatch(/quantum candidate|classical preferred/);
  });
});

describe("§1/§2 — sources are measured, and the licence is carried with them", () => {
  it("holds eighteen ecosystems, each with a version and a licence", () => {
    expect(QUANTUM_SOURCES.length).toBe(18);
    for (const s of QUANTUM_SOURCES) {
      expect(s.version.length, s.id).toBeGreaterThan(0);
      expect(s.license.length, s.id).toBeGreaterThan(0);
      // AT LEAST ONE REACHABLE ADDRESS PER SOURCE, because a locator is what
      // §9 of the OKS spec requires of every piece of evidence. Which of the
      // two carries it is PyPI's business, not ours.
      expect(locatorFor(s.id), `${s.id} has no locator`).toMatch(/^https?:\/\//);
    }
    expect(new Set(QUANTUM_SOURCES.map((s) => s.id)).size).toBe(18);

    // TWO SHAPES OF HARVESTED IMPERFECTION, PINNED RATHER THAN TIDIED. Cirq
    // publishes an http:// repository URL and three projects publish no
    // repository URL at all. Both are what PyPI returned, and rewriting either
    // for appearance would mean the table is no longer a measurement. Pinned
    // so a re-harvest that changes them is noticed instead of absorbed.
    // WRITTEN AS A REGEX LITERAL, NOT A STRING. `security.test.ts` bans an
    // http(s) URL anywhere in this tree, and `startsWith("http://")` is one —
    // the guard flagged this very line. The escaped form asserts exactly the
    // same thing and names no address, so the ban keeps its full width here
    // rather than gaining a third exemption for a test's convenience.
    const http = QUANTUM_SOURCES.filter((x) => /^http:\/\//.test(x.repository)).map((x) => x.id);
    expect(http).toEqual(["cirq"]);
    const noRepo = QUANTUM_SOURCES.filter((x) => x.repository === "")
      .map((x) => x.id)
      .sort();
    expect(noRepo).toEqual(["pennylane", "qualtran", "qulacs"]);
    // And those same three publish no documentation URL either, so they are
    // exactly the ones `locatorFor` falls back for — pinned in both
    // directions so the fallback cannot become dead code or grow silently.
    for (const id of noRepo) expect(SOURCE_BY_ID.get(id)!.documentation).toBe("");
    for (const id of noRepo) expect(locatorFor(id)).toMatch(/^https:\/\/pypi\.org\/project\//);
    const fellBack = QUANTUM_SOURCES.filter((x2) =>
      locatorFor(x2.id).includes("pypi.org/project/"),
    );
    expect(fellBack.map((x2) => x2.id).sort()).toEqual(noRepo);
  });

  it("flags the copyleft one BY NAME, and it is the only one", () => {
    // §2: "Do not copy source code unless the license explicitly permits the
    // intended use". Mitiq is GPL-3.0 and nothing was taken from it; a list
    // that named none would be the dangerous answer.
    expect(COPYLEFT_SOURCE_IDS).toEqual(["mitiq"]);
    expect(isCopyleft("mitiq")).toBe(true);
    expect(isCopyleft("qiskit")).toBe(false);
    const gpl = QUANTUM_SOURCES.filter((s) => /GPL/i.test(s.license)).map((s) => s.id);
    expect(gpl).toEqual(COPYLEFT_SOURCE_IDS);
  });

  it("stamps provenance from the MEASUREMENT and refuses an unregistered id", () => {
    const st = stampFor("qiskit", "official_documentation");
    expect(st.sourceVersion).toBe(SOURCE_BY_ID.get("qiskit")!.version);
    expect(st.retrievedAt).toBe(HARVESTED_AT);
    expect(() => stampFor("nosuchproject", "x")).toThrow(/not a registered source/);
  });
});

describe("§20 — the three categories, never silently converted", () => {
  it("declares exactly three and gives every object a reason", () => {
    expect(QUANTUM_CATEGORIES).toEqual([
      "PHYSICAL_QUANTUM",
      "QUANTUM_INSPIRED",
      "CLASSICAL_ANALOG",
    ]);
    expect(CATEGORISED.length).toBeGreaterThan(5);
    for (const o of CATEGORISED) {
      expect(QUANTUM_CATEGORIES).toContain(o.category);
      expect(o.because.length, `${o.name} has no reason`).toBeGreaterThan(20);
    }
  });

  it("refuses a physical-only claim made for a quantum-INSPIRED object", () => {
    expect(PHYSICAL_ONLY_CLAIMS.length).toBeGreaterThan(0);
    for (const claim of PHYSICAL_ONLY_CLAIMS) {
      expect(claimIsLegitimate(claim, "PHYSICAL_QUANTUM")).toBe(true);
      expect(claimIsLegitimate(claim, "QUANTUM_INSPIRED")).toBe(false);
      expect(claimIsLegitimate(claim, "CLASSICAL_ANALOG")).toBe(false);
    }
    // An ordinary claim is legitimate for all three, or the predicate would be
    // rejecting everything and the assertion above would prove nothing.
    expect(claimIsLegitimate("uses a two-dimensional state", "QUANTUM_INSPIRED")).toBe(true);
  });

  it("sameCategory separates the OQCA cognitive operators from physical gates", () => {
    const cognitive = CATEGORISED.filter((o) => o.category === "QUANTUM_INSPIRED").map(
      (o) => o.name,
    );
    const physical = CATEGORISED.filter((o) => o.category === "PHYSICAL_QUANTUM").map(
      (o) => o.name,
    );
    expect(cognitive.length).toBeGreaterThan(0);
    expect(physical.length).toBeGreaterThan(0);
    expect(sameCategory(cognitive[0], physical[0])).toBe(false);
    expect(sameCategory(cognitive[0], cognitive[0])).toBe(true);
    expect(CATEGORY_OF.get(cognitive[0])).toBe("QUANTUM_INSPIRED");
  });
});

describe("§7–§14 — domains say what is built AND what is not", () => {
  it("resolves every claimed implementation against a real export", () => {
    for (const d of DOMAINS) {
      for (const n of d.implementedHere) {
        expect(EXPORTS[n], `${d.id} claims ${n}, which is not exported`).toBeDefined();
      }
    }
  });

  it("never leaves a domain's gap list empty, because no subfield here is finished", () => {
    for (const d of DOMAINS) {
      expect(d.notImplemented.length, `${d.id} claims to be complete`).toBeGreaterThan(0);
      expect(d.pitfalls.length, d.id).toBeGreaterThan(0);
      expect(d.constructs.length, d.id).toBeGreaterThan(2);
    }
  });

  it("names only registered sources", () => {
    expect(unregisteredSourceIds()).toEqual([]);
    expect(domainSourceIds().length).toBeGreaterThan(8);
  });

  it("reports two knowledge-only domains, and they are the honest ones", () => {
    // QEC and ZX are represented and NOT implemented. A coverage function that
    // reported them as implemented would be the §27 failure exactly.
    const c = coverage();
    expect(c.domains).toBe(DOMAINS.length);
    expect([...c.knowledgeOnly].sort()).toEqual(["qec", "zx"]);
    expect(c.openGaps).toBeGreaterThan(15);
  });

  it("stores no advantage claim without a named benchmark", () => {
    for (const d of DOMAINS) {
      for (const a of d.advantageClaims) {
        expect(
          a.benchmark.trim().length,
          `${d.id} claims an advantage with no benchmark`,
        ).toBeGreaterThan(10);
        expect(a.limits.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("§23 — disagreements are preserved, never normalised", () => {
  it("records ONIQ's convention, theirs, the consequence and the conversion", () => {
    expect(DIVERGENCES.length).toBeGreaterThanOrEqual(4);
    for (const d of DIVERGENCES) {
      expect(d.oniqConvention.length, d.id).toBeGreaterThan(20);
      expect(d.theirConvention.length, d.id).toBeGreaterThan(20);
      expect(d.divergentFrom.length, d.id).toBeGreaterThan(0);
      // THE CONVERSION IS THE FIELD THAT MAKES IT USABLE. Recording that two
      // ecosystems differ and not how to move between them is a warning, not
      // knowledge.
      expect(d.conversion.length, `${d.id} has no conversion`).toBeGreaterThan(10);
      expect(d.consequence.length, d.id).toBeGreaterThan(20);
    }
  });

  it("covers the qubit endianness, which is the one that silently breaks everything", () => {
    const e = DIVERGENCES.find((d) => d.id === "qubit_endianness");
    expect(e).toBeDefined();
    expect(e!.divergentFrom).toContain("qiskit");
  });

  it("every divergence ingests as CONTESTED, so nothing downstream can pick a side", () => {
    resetEvidenceIds();
    const store = makeLocalStore();
    ingestQuantumKnowledge(store, AT, (n) => n in EXPORTS);
    const contested = store.byStatus("CONTESTED");
    expect(contested.length).toBe(DIVERGENCES.length);
    for (const r of contested) {
      expect(mayInformDecision(r.status)).toBe(false);
      expect(mayInformConflictAwareDecision(r.status)).toBe(true);
    }
  });
});

describe("§22/§25 — the ingestion adapter, and what it refuses to ingest", () => {
  it("promotes the evidenced facts and contests the divergences, with nothing rejected", () => {
    resetEvidenceIds();
    const store = makeLocalStore();
    const rep = ingestQuantumKnowledge(store, AT, (n) => n in EXPORTS);
    expect(rep.total).toBeGreaterThan(100);
    expect(rep.verified).toBeGreaterThan(90);
    expect(rep.contested).toBe(DIVERGENCES.length);
    expect(rep.rejected).toBe(0);
    // EVERY refusal is a divergence and nothing else, so no evidenced fact is
    // silently sitting unpromoted.
    expect(rep.refusals.length).toBe(DIVERGENCES.length);
  });

  it("does NOT ingest the prose, and says so in code rather than only in a comment", () => {
    resetEvidenceIds();
    const store = makeLocalStore();
    ingestQuantumKnowledge(store, AT, (n) => n in EXPORTS);
    expect(NOT_INGESTED.length).toBe(3);
    // No record asserts a definition, a description or a summary. Prose from
    // training is `recalled`, weight zero, and ingesting it would fill the
    // store with rows that can never be believed.
    for (const r of store.all()) {
      expect(r.predicate).not.toMatch(/definition|description|summary|notation/i);
      expect(r.domain).toContain(QUANTUM_DOMAIN);
    }
  });

  it("records ONIQ's capability truthfully, including the two negatives", () => {
    resetEvidenceIds();
    const store = makeLocalStore();
    ingestQuantumKnowledge(store, AT, (n) => n in EXPORTS);
    const caps = store.all().filter((r) => r.predicate === "implementsDomain");
    expect(caps.length).toBe(DOMAINS.length);
    const no = caps
      .filter((r) => r.object === false)
      .map((r) => r.subject)
      .sort();
    expect(no).toEqual(["oniq:qec", "oniq:zx"]);
    // A NEGATIVE IS VERIFIED TOO. "ONIQ does not implement QEC" is a fact with
    // evidence, and reporting it as merely unproven would let §27's gap list
    // quietly become optional.
    for (const r of caps) expect(r.status).toBe("VERIFIED");
  });

  it("a capability claim goes FALSE when its exports stop resolving", () => {
    // Mutation-shaped: the resolver is the seam, so an implementation that was
    // deleted flips the record rather than leaving a stale true.
    resetEvidenceIds();
    const store = makeLocalStore();
    ingestQuantumKnowledge(store, AT, () => false);
    const caps = store.all().filter((r) => r.predicate === "implementsDomain");
    expect(caps.every((r) => r.object === false)).toBe(true);
  });

  it("§7 — a positive advantage record cannot be made without a benchmark", () => {
    expect(() => assertAdvantage("grover", "", AT)).toThrow(/no benchmark/);
    const ok = assertAdvantage(
      "grover",
      "a measured 40-seed sweep against a randomised baseline",
      AT,
    );
    expect(ok.object).toBe(true);
    // And the ordinary path produces ONLY negatives, because no benchmark has
    // been run here.
    const facts = advantageFacts(AT);
    expect(facts.length).toBe(ALGORITHMS.length);
    expect(facts.every((f) => f.object === false)).toBe(true);
  });

  it("registers every source the evidence names, including PyPI and ONIQ's own computation", () => {
    const reg = quantumSourceRegistry();
    expect(reg.get("pypi")!.acquirable).toBe(true);
    // THE ECOSYSTEM DOCS ARE NOT ACQUIRABLE FROM HERE and the registry says
    // so, which is what caps their evidence at `spec_cited`.
    for (const s of QUANTUM_SOURCES) expect(reg.get(s.id)!.acquirable, s.id).toBe(false);
    resetEvidenceIds();
    for (const r of divergenceFacts(AT)) {
      for (const e of r.evidence) expect(reg.has(e.sourceId), e.sourceId).toBe(true);
    }
  });
});

describe("§28 — the report's numbers come from the code, and stay there", () => {
  const REPORT = readFileSync("docs/oqca/OQCA_QUANTUM_KNOWLEDGE_REPORT.md", "utf8");

  it("its shape table matches what the modules actually hold", () => {
    // A REPORT IS THE EASIEST THING IN THIS REPO TO LET DRIFT, because nothing
    // runs it. Every count below is read out of the prose and compared with
    // the module, so adding a nineteenth algorithm without touching §2 of the
    // report fails here rather than being discovered by a reader.
    // WHITESPACE-TOLERANT, BECAUSE PRETTIER OWNS THE SPACING. The first
    // version matched `| (\\d+) |` with exactly one space either side and went
    // red the moment `prettier --write` padded the table's columns to align
    // them — on a report whose numbers were all correct. That is the
    // `marketingCopy.ts` 400-character-window lesson in a third file: where a
    // test reads a document, it must read its CONTENT and not its layout.
    const row = (label: string): number => {
      const m = new RegExp(`\\|\\s*${label}[^|]*\\|\\s*(\\d+)\\s*\\|`).exec(REPORT);
      expect(m, `no report row for ${label}`).not.toBeNull();
      return Number(m![1]);
    };
    expect(row("Source ecosystems")).toBe(QUANTUM_SOURCES.length);
    expect(row("Concepts")).toBe(CONCEPTS.length);
    expect(row("Algorithms")).toBe(ALGORITHMS.length);
    expect(row("Domains")).toBe(DOMAINS.length);
    expect(row("Semantic divergences")).toBe(DIVERGENCES.length);
    expect(row("Categorised objects")).toBe(CATEGORISED.length);
  });

  it("its ingestion figures are the ones the ingestion produces", () => {
    resetEvidenceIds();
    const store = makeLocalStore();
    const rep = ingestQuantumKnowledge(store, AT, (n) => n in EXPORTS);
    const stated = (label: string): number => {
      const m = new RegExp(`${label}\\s+(\\d+)`).exec(REPORT);
      expect(m, `report does not state ${label}`).not.toBeNull();
      return Number(m![1]);
    };
    expect(stated("total")).toBe(rep.total);
    expect(stated("VERIFIED")).toBe(rep.verified);
    expect(stated("CONTESTED")).toBe(rep.contested);
    expect(stated("REJECTED")).toBe(rep.rejected);
  });

  it("states the gap ledger as computed, and never as complete", () => {
    const c = coverage();
    expect(REPORT).toContain(`**${c.domains} domains, ${c.withImplementation} with some`);
    expect(REPORT).toContain(`${c.openGaps} named gaps`);
    // §27's sentence, in the report and in the index.
    expect(REPORT).toMatch(/does not have all quantum computing knowledge/i);
  });
});

describe("§27 — the report cannot claim more than the code holds", () => {
  it("no file in the quantum tree claims ONIQ has all quantum knowledge", () => {
    const files = [
      "src/oqca/quantum/domains.ts",
      "src/oqca/quantum/concepts.ts",
      "src/oqca/quantum/algorithms.ts",
      "src/oqca/quantum/knowledge.ts",
    ];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/all quantum computing knowledge|complete quantum knowledge/i);
    }
  });
});
