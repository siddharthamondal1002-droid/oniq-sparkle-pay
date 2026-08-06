/**
 * Phase 1 — blueprint, assertion-reason generation, and the key gate.
 *
 * Verification items 5 and 6 ask for twenty assertion-reason items with an
 * exact four-option structure, no invented fifth case, and (a) versus (b)
 * turning on the causal link. The twenty are generated here from task models
 * rather than pasted, because that is the thing being tested: the loop's
 * Rule 3 is template-first, and a hand-written batch would prove nothing
 * about the generator.
 */
import { describe, expect, it } from "vitest";
import {
  type Allocation,
  BLUEPRINTS,
  allocateMarks,
  allocationMatchesBlueprint,
  blueprintFor,
} from "@/lib/assessmentBlueprint";
import {
  type ARTaskModel,
  ASSERTION_REASON_OPTIONS,
  BothFalseError,
  deriveKey,
  deriveKeyIndependently,
  instantiateAR,
  validateARTaskModel,
} from "@/lib/assertionReason";
import {
  KEY_ERROR_LIMIT,
  freeGenerationAllowed,
  itemStatusFor,
  verifyKey,
} from "@/lib/keyVerification";
import { itemPasses, lintItem } from "@/lib/itemLint";

// ---------------------------------------------------------------------------
// 1.1 Blueprint
// ---------------------------------------------------------------------------

describe("blueprint weights are whole and dated", () => {
  it("every blueprint's weights sum to one", () => {
    for (const [k, b] of Object.entries(BLUEPRINTS)) {
      const s = b.weights.competency + b.weights.mcq + b.weights.constructed;
      expect(s, `${k} sums to ${s}`).toBeCloseTo(1, 9);
    }
  });

  it("records where each number came from and when", () => {
    for (const [k, b] of Object.entries(BLUEPRINTS)) {
      expect(b.verifiedOn, k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.source.length, k).toBeGreaterThan(20);
    }
  });

  it("keeps CBSE at the 50/20/30 design re-checked this session", () => {
    const w = BLUEPRINTS.cbse.weights;
    expect(w.competency).toBe(0.5);
    expect(w.mcq).toBe(0.2);
    expect(w.constructed).toBe(0.3);
  });

  it("says plainly that CBSE's figure is from secondary sources", () => {
    // The circular is not machine-readable from here. Recording that stops
    // the number being inherited later as though it were read from source.
    expect(BLUEPRINTS.cbse.source).toMatch(/not read from the circular/i);
  });

  it("weights other systems by their own axis, not CBSE's", () => {
    // ICSE leans on extended written response; IB on command terms.
    expect(BLUEPRINTS.icse.weights.constructed).toBeGreaterThan(
      BLUEPRINTS.cbse.weights.constructed,
    );
    expect(BLUEPRINTS.ib.axis).toBe("command term");
    expect(BLUEPRINTS.uk.axis).toBe("assessment objective");
  });

  it("falls back to CBSE for an unknown system", () => {
    expect(blueprintFor("nope").system).toBe("cbse");
    expect(blueprintFor("ib").system).toBe("ib");
  });
});

describe("allocation always sums to the paper total", () => {
  const totals = [20, 30, 35, 40, 50, 70, 80, 90, 100];

  it("never loses or invents a mark, on any total or any system", () => {
    for (const b of Object.values(BLUEPRINTS)) {
      for (const total of totals) {
        const alloc = allocateMarks(total, b.weights);
        const sum = alloc.reduce((a: number, x: Allocation) => a + x.marks, 0);
        expect(sum, `${b.system} @ ${total} summed to ${sum}`).toBe(total);
      }
    }
  });

  it("stays close to the blueprint after rounding", () => {
    for (const b of Object.values(BLUEPRINTS)) {
      for (const total of totals) {
        const alloc = allocateMarks(total, b.weights);
        expect(
          allocationMatchesBlueprint(alloc, b.weights),
          `${b.system} @ ${total}: ${JSON.stringify(alloc.map((a) => [a.band, a.marks]))}`,
        ).toBe(true);
      }
    }
  });

  it("gives CBSE 80 marks the expected 40/16/24", () => {
    const alloc = allocateMarks(80, BLUEPRINTS.cbse.weights);
    expect(alloc.find((a) => a.band === "competency")!.marks).toBe(40);
    expect(alloc.find((a) => a.band === "mcq")!.marks).toBe(16);
    expect(alloc.find((a) => a.band === "constructed")!.marks).toBe(24);
  });

  it("refuses a nonsense total rather than producing a nonsense paper", () => {
    expect(() => allocateMarks(0, BLUEPRINTS.cbse.weights)).toThrow();
    expect(() => allocateMarks(-5, BLUEPRINTS.cbse.weights)).toThrow();
    expect(() => allocateMarks(33.5, BLUEPRINTS.cbse.weights)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 1.2 Assertion-reason — twenty generated items
// ---------------------------------------------------------------------------

/** Four content pairs, each instantiated across the five legal truth states. */
const CONTENT = [
  {
    id: "refraction",
    competency: "Explain apparent depth as a consequence of refraction",
    assertion: "A swimmer appears shorter than she is when seen from the edge of a pool.",
    reason: "Light bends away from the normal as it passes from water into air.",
    explanation:
      "Rays from the swimmer's feet bend away from the normal on leaving the water, so they reach the eye as though they came from a shallower point. The apparent shortening follows directly from that bending.",
  },
  {
    id: "momentum",
    competency: "Distinguish conservation of momentum from conservation of kinetic energy",
    assertion: "Momentum is conserved when two railway wagons couple together on impact.",
    reason: "No external horizontal force acts on the two wagons during the collision.",
    explanation:
      "Momentum conservation follows from the absence of a net external force, not from whether the collision is elastic. Kinetic energy is lost here, and momentum is still conserved.",
  },
  {
    id: "transpiration",
    competency: "Relate transpiration pull to water movement in xylem",
    assertion: "Water rises to the top of a tall tree without any pump.",
    reason: "Evaporation from the leaves lowers the pressure at the top of the xylem column.",
    explanation:
      "Transpiration pull plus cohesion between water molecules carries a continuous column upward. No active pumping is involved at any point.",
  },
  {
    id: "resistance",
    competency: "Relate resistance to length and cross-section",
    assertion:
      "A thin wire glows brighter than a thick one of the same material in a series circuit.",
    reason: "Resistance decreases as the cross-sectional area of a conductor decreases.",
    explanation:
      "In series the current is common, so the greater resistance dissipates more power. But the stated reason inverts the relationship — resistance INCREASES as area decreases.",
  },
] as const;

/** The five legal truth states. Both-false is absent because it cannot exist. */
const STATES: { a: boolean; r: boolean; x: boolean; expect: 0 | 1 | 2 | 3 }[] = [
  { a: true, r: true, x: true, expect: 0 },
  { a: true, r: true, x: false, expect: 1 },
  { a: true, r: false, x: false, expect: 2 },
  { a: false, r: true, x: false, expect: 3 },
  { a: true, r: true, x: true, expect: 0 },
];

function modelFor(c: (typeof CONTENT)[number], s: (typeof STATES)[number], n: number): ARTaskModel {
  return {
    id: `${c.id}-${n}`,
    competency: c.competency,
    assertion: c.assertion,
    reason: c.reason,
    assertionTrue: s.a,
    reasonTrue: s.r,
    reasonExplainsAssertion: s.x,
    explanation: c.explanation,
    distractorRationales: {
      0: "Accepts the causal link without checking that the reason actually accounts for the assertion.",
      1: "Sees both statements as true but misses that the reason does explain the assertion.",
      2: "Rejects the reason as false when it is a correct statement in its own right.",
      3: "Rejects the assertion, usually by treating the observed effect as an illusion of the eye.",
    },
    marks: 1,
  };
}

const TWENTY: ARTaskModel[] = CONTENT.flatMap((c, ci) =>
  STATES.map((s, si) => modelFor(c, s, ci * STATES.length + si)),
);

describe("twenty generated assertion-reason items", () => {
  it("generated exactly twenty", () => {
    expect(TWENTY).toHaveLength(20);
  });

  it("every one has the exact four-option structure", () => {
    for (const m of TWENTY) {
      const item = instantiateAR(m);
      expect(item.options, m.id).toHaveLength(4);
      expect(item.options).toEqual([...ASSERTION_REASON_OPTIONS]);
    }
  });

  it("no item invents a fifth case", () => {
    const joined = ASSERTION_REASON_OPTIONS.join(" ").toLowerCase();
    expect(joined).not.toMatch(/both a and r are false|both are false|none of/);
    for (const m of TWENTY) {
      expect(instantiateAR(m).options).toHaveLength(4);
    }
  });

  it("both derivations agree on all twenty", () => {
    for (const m of TWENTY) {
      expect(deriveKeyIndependently(m), m.id).toBe(deriveKey(m));
    }
  });

  it("derives the key the truth state implies", () => {
    TWENTY.forEach((m, i) => {
      expect(deriveKey(m), m.id).toBe(STATES[i % STATES.length].expect);
    });
  });

  it("every generated item clears the item lint", () => {
    for (const m of TWENTY) {
      const item = instantiateAR(m);
      const findings = lintItem({
        stem: item.stem,
        options: item.options,
        keyIndex: item.keyIndex,
        format: "assertion_reason",
        gradeYears: 10,
        distractorRationales: item.distractorRationales,
      });
      expect(
        itemPasses(findings),
        `${m.id}: ${JSON.stringify(findings.filter((f) => f.severity === "reject"))}`,
      ).toBe(true);
    }
  });

  it("covers every legal key across the batch", () => {
    const keys = new Set(TWENTY.map(deriveKey));
    expect([...keys].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("(a) versus (b) turns on the causal link alone", () => {
  it("flipping only reasonExplainsAssertion moves the key between (a) and (b)", () => {
    const base = modelFor(CONTENT[0], STATES[0], 99);
    expect(deriveKey({ ...base, reasonExplainsAssertion: true })).toBe(0);
    expect(deriveKey({ ...base, reasonExplainsAssertion: false })).toBe(1);
    // Both truth values are unchanged; only the link moved.
    expect(base.assertionTrue && base.reasonTrue).toBe(true);
  });

  it("the two options are identical on truth and differ only on explanation", () => {
    expect(ASSERTION_REASON_OPTIONS[0]).toContain("Both A and R are true");
    expect(ASSERTION_REASON_OPTIONS[1]).toContain("Both A and R are true");
    expect(ASSERTION_REASON_OPTIONS[0]).toContain("is the correct explanation");
    expect(ASSERTION_REASON_OPTIONS[1]).toContain("is not the correct explanation");
  });
});

describe("both-false is unrepresentable, not merely discouraged", () => {
  const bothFalse = {
    ...modelFor(CONTENT[0], STATES[0], 100),
    assertionTrue: false,
    reasonTrue: false,
    reasonExplainsAssertion: false,
  };

  it("deriveKey throws rather than inventing an option", () => {
    expect(() => deriveKey(bothFalse)).toThrow(BothFalseError);
    expect(() => deriveKeyIndependently(bothFalse)).toThrow(BothFalseError);
  });

  it("validation names it before a key is ever derived", () => {
    const errs = validateARTaskModel(bothFalse);
    expect(errs.map((e) => e.field)).toContain("assertionTrue/reasonTrue");
  });

  it("instantiate refuses it", () => {
    expect(() => instantiateAR(bothFalse)).toThrow();
  });
});

describe("authoring slips are caught before the gate", () => {
  const base = modelFor(CONTENT[1], STATES[1], 101);

  it("rejects 'R explains A' when one of them is false", () => {
    // deriveKey ignores the flag once a statement is false, so without this
    // check the author's intent would be silently discarded and the item
    // would look perfectly fine.
    const errs = validateARTaskModel({
      ...base,
      reasonTrue: false,
      reasonExplainsAssertion: true,
    });
    expect(errs.map((e) => e.field)).toContain("reasonExplainsAssertion");
  });

  it("rejects a reason that restates the assertion", () => {
    const errs = validateARTaskModel({ ...base, reason: base.assertion });
    expect(errs.map((e) => e.field)).toContain("reason");
  });

  it("rejects a distractor with no named misconception", () => {
    const errs = validateARTaskModel({ ...base, distractorRationales: { 0: "x" } });
    expect(errs.some((e) => e.field.startsWith("distractorRationales"))).toBe(true);
  });

  it("accepts a well-formed model", () => {
    expect(validateARTaskModel(base)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.5 The key verification gate
// ---------------------------------------------------------------------------

describe("the key gate", () => {
  it("approves when two independent derivations agree", () => {
    const o = verifyKey([
      { method: "truth-table", key: "0" },
      { method: "count-then-link", key: "0" },
    ]);
    expect(o.verified).toBe(true);
    expect(o.verifiedBy).toBe("derivation");
    expect(o.quarantine).toBe(false);
  });

  it("quarantines a disagreement, and does not resolve it by vote", () => {
    const o = verifyKey([
      { method: "truth-table", key: "0" },
      { method: "count-then-link", key: "1" },
      { method: "solver", key: "0" },
    ]);
    expect(o.verified).toBe(false);
    expect(o.quarantine).toBe(true);
    expect(o.key, "a majority winner was picked").toBeNull();
    expect(o.reason).toMatch(/not resolved by vote/i);
  });

  it("rejects two runs of the same method as not independent", () => {
    // Two calls to one function agree about that function's bugs. Accepting
    // them would make the gate a formality that agrees with itself.
    const o = verifyKey([
      { method: "truth-table", key: "0" },
      { method: "truth-table", key: "0" },
    ]);
    expect(o.verified).toBe(false);
    expect(o.reason).toMatch(/not independent/i);
  });

  it("quarantines a single derivation", () => {
    expect(verifyKey([{ method: "truth-table", key: "0" }]).quarantine).toBe(true);
    expect(verifyKey([]).quarantine).toBe(true);
  });

  it("lets a human override a disagreement, recorded as human", () => {
    const o = verifyKey(
      [
        { method: "a", key: "0" },
        { method: "b", key: "1" },
      ],
      {
        userId: "u1",
        key: "0",
        approvedAt: "2026-08-06T00:00:00Z",
      },
    );
    expect(o.verified).toBe(true);
    expect(o.verifiedBy, "a human approval was recorded as a machine check").toBe("human");
  });

  it("maps an outcome onto the columns the database will accept", () => {
    const ok = itemStatusFor(
      verifyKey([
        { method: "a", key: "2" },
        { method: "b", key: "2" },
      ]),
    );
    expect(ok.status).toBe("approved");
    expect(ok.key_verified_by).toBe("derivation");

    const bad = itemStatusFor(verifyKey([{ method: "a", key: "2" }]));
    expect(bad.status).toBe("quarantined");
    expect(bad.key_verified_by).toBeNull();
    expect(bad.quarantine_reason).toBeTruthy();
  });

  it("runs all twenty items through the gate and approves every one", () => {
    for (const m of TWENTY) {
      const o = verifyKey([
        { method: "truth-table", key: String(deriveKey(m)) },
        { method: "count-then-link", key: String(deriveKeyIndependently(m)) },
      ]);
      expect(o.verified, `${m.id} did not verify`).toBe(true);
    }
  });

  it("catches a planted key error rather than waving it through", () => {
    // The gate is only worth having if a wrong second derivation stops the
    // item. Proved by planting one.
    const m = TWENTY[0];
    const wrong = (deriveKey(m) + 1) % 4;
    const o = verifyKey([
      { method: "truth-table", key: String(deriveKey(m)) },
      { method: "count-then-link", key: String(wrong) },
    ]);
    expect(o.quarantine).toBe(true);
  });
});

describe("the 2% key-error trigger is code, not a note", () => {
  it("allows free generation at or below the limit", () => {
    expect(freeGenerationAllowed(100, 2)).toBe(true);
    expect(KEY_ERROR_LIMIT).toBe(0.02);
  });

  it("switches free generation off above it", () => {
    expect(freeGenerationAllowed(100, 3)).toBe(false);
  });

  it("defaults to template-only when nothing has been checked", () => {
    // An empty sample is not a passing sample, and this is the state the
    // project is actually in right now.
    expect(freeGenerationAllowed(0, 0)).toBe(false);
  });
});
