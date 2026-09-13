/**
 * The worker's story-plot request, EVALUATED — not read.
 *
 * 2026-09-13: three 60-second movie jobs failed in production with the literal
 * message `storySeconds is not defined`. The identifier had no declaration
 * anywhere in remotion/scripts/story-worker.mjs, so every movie-grade job threw
 * a ReferenceError the moment the plot request object was built — before the
 * first billable call, which is the only reason it cost nothing but the wait.
 *
 * WHY THIS EVALUATES RATHER THAN GREPS. A source-pattern assertion would have
 * passed on the broken line: the text `screenSeconds` was present and spelled
 * correctly. Only running the object literal produces the ReferenceError, and
 * `node --check` cannot see it either — an undeclared identifier is valid
 * syntax. So the literal is extracted from the real file and executed in a
 * scope holding exactly what the worker has in scope at that point.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(process.cwd(), "remotion/scripts/story-worker.mjs"), "utf8");

/** The `{ … }` handed to edge('story-plot', …), lifted out by brace balance. */
function plotRequestLiteral(): string {
  const marker = "edge('story-plot', {";
  const start = SOURCE.indexOf(marker);
  expect(start, "the story-plot call moved or was renamed").toBeGreaterThan(-1);
  const open = start + marker.length - 1;
  let depth = 0;
  for (let i = open; i < SOURCE.length; i++) {
    const ch = SOURCE[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return SOURCE.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced story-plot request literal");
}

type Job = Record<string, unknown>;

/**
 * Build the request the way the worker does, with ONLY the bindings the worker
 * genuinely has there: job, shots, verbatimChunks. Anything else the literal
 * names is an undeclared identifier and throws, which is the bug.
 */
function buildRequest(job: Job, shots: number, verbatimChunks: string[] | null) {
  const fn = new Function(
    "job",
    "shots",
    "verbatimChunks",
    `"use strict"; return (${plotRequestLiteral()});`,
  ) as (j: Job, s: number, v: string[] | null) => Record<string, unknown>;
  return fn(job, shots, verbatimChunks);
}

const movieJob: Job = {
  prompt: "A quiet street at dawn.",
  grade: "movie",
  requestedSeconds: 60,
  language: "en",
  verbatim: false,
  castJson: [],
};

describe("the worker's story-plot request", () => {
  it("sends the paid length as screenSeconds on a movie job", () => {
    // Fails with `ReferenceError: storySeconds is not defined` before the fix.
    const req = buildRequest(movieJob, 9, null);
    expect(req.screenSeconds).toBe(60);
    expect(req.shots).toBe(9);
    expect(req.prompt).toBe("A quiet street at dawn.");
  });

  it("omits screenSeconds entirely on a non-movie job", () => {
    const req = buildRequest({ ...movieJob, grade: "classic" }, 9, null);
    expect("screenSeconds" in req).toBe(false);
  });

  it("still carries language, narrations and reuse", () => {
    const req = buildRequest({ ...movieJob, language: "hi", castJson: [{ id: "a" }] }, 2, [
      "one",
      "two",
    ]);
    expect(req.lang).toBe("hi");
    expect(req.narrations).toEqual(["one", "two"]);
    expect(req.reuse).toEqual([{ id: "a" }]);
  });

  it("names no identifier the worker does not have in scope there", () => {
    // The whole class of defect, not just this instance: any future
    // undeclared name in this literal throws here rather than in production.
    expect(() => buildRequest(movieJob, 9, null)).not.toThrow();
  });
});
