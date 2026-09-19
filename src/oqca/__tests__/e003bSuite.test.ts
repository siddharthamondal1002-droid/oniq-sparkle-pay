import { describe, expect, it } from "vitest";
import {
  E003B_FAMILIES,
  armOrder,
  assertRunnableE003B,
  plannedExecutions,
  validateE003BSuite,
  type E003BSuite,
  type E003BTask,
} from "../benchmarks/e003b.ts";

function task(id: string, family: (typeof E003B_FAMILIES)[number], visibility: E003BTask["visibility"], faultInjected = false): E003BTask {
  return {
    id,
    family,
    visibility,
    prompt: `prompt ${id}`,
    initialEvidence: [],
    toolCatalog: [],
    rubric: ["correct"],
    expected: { answer: id },
    faultInjected,
    safetyTags: [],
    canary: `canary-${id}`,
  };
}

function validSuite(): E003BSuite {
  const tasks: E003BTask[] = [];
  for (const [fi, family] of E003B_FAMILIES.entries()) {
    for (let i = 0; i < 2; i++) tasks.push(task(`${family}-dev-${i}`, family, "public_dev"));
    for (let i = 0; i < 6; i++)
      tasks.push(task(`${family}-sealed-${i}`, family, "sealed_core", fi < 2));
  }
  for (let i = 0; i < 300; i++)
    tasks.push(task(`safety-${i}`, E003B_FAMILIES[i % E003B_FAMILIES.length], "safety"));
  return {
    schemaVersion: "e003b-suite-v1",
    suiteId: "suite-v1",
    createdAt: "2026-09-19T00:00:00Z",
    model: "gemini-3.1-flash-lite",
    tasks,
  };
}

describe("E-003B suite contract", () => {
  it("accepts exactly 96 core + 300 safety cases and plans 876 executions", () => {
    const suite = validSuite();
    expect(validateE003BSuite(suite)).toEqual([]);
    expect(plannedExecutions(suite)).toBe(876);
    expect(() => assertRunnableE003B(suite)).not.toThrow();
  });

  it("refuses an easier public/sealed split", () => {
    const suite = validSuite();
    const tasks = suite.tasks.map((t) =>
      t.id === "novel-reasoning-sealed-0" ? { ...t, visibility: "public_dev" as const } : t,
    );
    const codes = validateE003BSuite({ ...suite, tasks }).map((x) => x.code);
    expect(codes).toContain("PUBLIC_SPLIT");
    expect(codes).toContain("SEALED_SPLIT");
  });

  it("refuses missing safety cases and insufficient injected failures", () => {
    const suite = validSuite();
    const tasks = suite.tasks
      .filter((t) => t.id !== "safety-299")
      .map((t) => ({ ...t, faultInjected: false }));
    const codes = validateE003BSuite({ ...suite, tasks }).map((x) => x.code);
    expect(codes).toContain("SAFETY_COUNT");
    expect(codes).toContain("INJECTED_FAILURE_COUNT");
  });

  it("refuses duplicate identifiers and canaries", () => {
    const suite = validSuite();
    const tasks = [...suite.tasks];
    tasks[1] = { ...tasks[1], id: tasks[0].id, canary: tasks[0].canary };
    const codes = validateE003BSuite({ ...suite, tasks }).map((x) => x.code);
    expect(codes).toContain("DUPLICATE_TASK_ID");
    expect(codes).toContain("DUPLICATE_CANARY");
  });

  it("counterbalances arm order deterministically", () => {
    const a = armOrder("task-a", 0);
    const b = armOrder("task-a", 0);
    expect(a).toEqual(b);
    expect(new Set(a)).toEqual(new Set(["direct", "bounded-agent"]));
  });
});
