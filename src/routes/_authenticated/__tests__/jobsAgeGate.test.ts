/**
 * The Jobs 18+ gate must FAIL CLOSED while the age check is in flight.
 *
 * THE BUG THIS PINS
 *
 * The gate rendered `isAdult === false ? <AgeGate/> : <content/>`. The
 * is_adult_18 query is `undefined` until it resolves, and `undefined !== false`,
 * so the 18+ CV/job tools rendered during the loading window — an under-18 (or
 * an account whose age has not yet been verified this session) saw the gated
 * tools for a beat before the gate closed. An age gate must never fail open.
 *
 * The fix renders the tools ONLY on an affirmative `isAdult === true`, a
 * neutral "checking access" state while undefined, and the AgeGateCard on
 * false. Asserted against source because the failure is a render-branch that a
 * node test cannot exercise through the DOM (the RPC + auth are server-side).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/app.jobs.tsx"),
  "utf8",
);

describe("Jobs age gate fails closed", () => {
  it("shows a loading state while the age check is undefined", () => {
    expect(src).toMatch(/isAdult === undefined \?/);
    expect(src).toMatch(/Checking access/);
  });

  it("still gates on an explicit false", () => {
    expect(src).toMatch(/isAdult === false \?/);
    expect(src).toContain("<AgeGateCard");
  });

  it("does not render content on a bare (non-false) isAdult — the old fail-open shape is gone", () => {
    // The previous single-ternary `{isAdult === false ? gate : content}` let
    // undefined fall through to content. The undefined branch must come FIRST.
    const undefIdx = src.indexOf("isAdult === undefined");
    const falseIdx = src.indexOf("isAdult === false");
    expect(undefIdx).toBeGreaterThan(-1);
    expect(falseIdx).toBeGreaterThan(undefIdx);
  });
});
