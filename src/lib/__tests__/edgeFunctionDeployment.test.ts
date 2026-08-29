/**
 * EVERY FUNCTION THE RUNNER CALLS MUST BE DEPLOYABLE AND REACHABLE BY IT.
 *
 * MEASURED 2026-08-29, story job fce10e2d. The clip stage fired correctly on
 * six of nine shots — the log reads "motion 4: WALKING/WALK — clip REQUESTED"
 * — and every one of them came back:
 *
 *     story-motion: 404 {"code":"NOT_FOUND","message":"Requested function was
 *     not found"}
 *
 * so the film fell back to stills and reported "0/9 shots have a
 * character-motion source". Three separate loops were spent on the motion
 * route — the claim stamping motion_mode, the dispatch forwarding it, the
 * worker opening the clip stage, the prompt ceiling — and all of them were
 * correct. The transport at the end of the chain had simply never been
 * deployed, because supabase/config.toml never declared it.
 *
 * The whole quality question was downstream of this: LTX had not run once, so
 * there was no motion whose quality could be judged. "Weak animation" was
 * Ken Burns over a still, every time.
 *
 * THE RULE, checked here rather than discovered in a film: if the story worker
 * calls it through edge(), it must be declared in config.toml with
 * verify_jwt = false. The runner sends x-story-job-token and NO Authorization
 * header, so an undeclared function is either 404 (never deployed) or 401
 * (gateway rejects before the function's own, stronger, token check runs).
 * Both are invisible until a paid film falls back to stills.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const worker = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");
const config = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");

/** Every `edge('name'` the worker can reach, in source order. */
function edgeTargets(src: string): string[] {
  return [...new Set([...src.matchAll(/edge\('([a-z-]+)'/g)].map((m) => m[1]))].sort();
}

/** Functions config.toml declares, with the verify_jwt value it gives each. */
function declared(toml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\[functions\.([a-z-]+)\]\s*\n(?:\s*#[^\n]*\n)*\s*verify_jwt\s*=\s*(\w+)/gm;
  for (const m of toml.matchAll(re)) out.set(m[1], m[2]);
  return out;
}

describe("the runner can reach every function it calls", () => {
  it("story-motion is declared — the one that was missing", () => {
    expect(declared(config).get("story-motion")).toBe("false");
  });

  it("every edge() target the worker calls is declared verify_jwt = false", () => {
    const targets = edgeTargets(worker);
    const decl = declared(config);
    // A guard that finds nothing to guard is not a guard.
    expect(targets.length).toBeGreaterThanOrEqual(5);
    const missing = targets.filter((t) => decl.get(t) !== "false");
    expect(missing, `undeclared or JWT-gated edge targets: ${missing.join(", ")}`).toEqual([]);
  });

  it("the motion transport sits beside its twin, not apart from it", () => {
    // story-clip and story-motion are the same shape of caller: runner-only,
    // job-token-only, no Authorization header. They must be treated alike.
    const decl = declared(config);
    expect(decl.get("story-clip")).toBe("false");
    expect(decl.get("story-motion")).toBe(decl.get("story-clip"));
  });

  it("story-motion authenticates by job token alone, which is why it needs the flag", () => {
    const fn = readFileSync(join(ROOT, "supabase/functions/story-motion/index.ts"), "utf8");
    expect(fn).toContain("verifyJobToken");
    expect(fn).toContain("x-story-job-token");
    // No user-JWT branch: nothing for the gateway to usefully check.
    expect(fn).not.toMatch(/auth\/v1\/user/);
  });

  it("the failure it prevents is recorded where the flag lives", () => {
    // So the next person reads the reason next to the line, not in a log.
    expect(config).toMatch(/story-motion/);
    expect(config).toMatch(/NOT_FOUND|never deployed|LTX has not run/i);
  });
});

describe("the fallback that hid it stays honest", () => {
  it("a failed clip still says so per shot and in the contract summary", () => {
    expect(worker).toMatch(/still carries the shot/);
    expect(worker).toMatch(/MOTION_VALIDATE \$\{motion\.verdict\}/);
    expect(worker).toMatch(/MOTION_CONTRACT/);
  });

  it("a still standing in for a clip is never counted as motion", () => {
    // The contract line separates clip-validated from fallback precisely so a
    // still-only film cannot read as an animated one.
    expect(worker).toMatch(/clip-validated/);
    expect(worker).toMatch(/character-motion source/);
  });
});
