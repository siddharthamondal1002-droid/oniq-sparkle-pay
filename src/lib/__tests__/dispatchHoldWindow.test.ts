/**
 * NOTHING MAY PARK A JOB FOR LONGER THAN THE SWEEP WILL TOLERATE IT.
 *
 * This is the rule the voice-budget gate broke, and the reason it broke is
 * worth stating precisely, because neither file was wrong on its own:
 *
 *   story-dispatch  held a job the day's remaining TTS budget could not
 *                   finish, "waiting for the Pacific-midnight reset", and
 *                   its comment promised the cost was "a job waiting a few
 *                   extra hours, not a dead film".
 *   story-sweep     fails any queued job untouched for STALE_TTL_MS — thirty
 *                   minutes — with "no renderer picked this up in time".
 *
 * Hours against thirty minutes. The state the dispatcher thought it was
 * parking jobs into did not exist: every film the remaining budget could not
 * cover was certain to die, and to die with a message blaming the renderer.
 * Measured on job eb0d052f, 2026-08-15.
 *
 * The gate is gone (owner directive, 2026-08-15), so the specific bug cannot
 * recur — but the SHAPE can, the next time someone adds a reason to wait. So
 * the invariant is asserted rather than the absence: every delay story-dispatch
 * can impose must fit inside the window story-sweep allows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DISPATCH = root("supabase/functions/story-dispatch/index.ts");
const SWEEP = root("supabase/functions/story-sweep/index.ts");

/** `const NAME = 30 * 60 * 1000;` and friends, evaluated. */
function msConst(src: string, name: string): number {
  const m = new RegExp(`const ${name} = ([0-9*\\s]+);`).exec(src);
  expect(m, `${name} is gone or its shape changed`).not.toBeNull();
  return (m![1].split("*").map((x) => Number(x.trim())) as number[]).reduce((a, b) => a * b, 1);
}

describe("the dispatcher cannot park a job past the sweep", () => {
  it("keeps every dispatch delay inside the sweep's stale window", () => {
    const stale = msConst(SWEEP, "STALE_TTL_MS");
    const backoff = msConst(DISPATCH, "DISPATCH_BACKOFF_MS");
    expect(stale).toBeGreaterThan(0);
    expect(
      backoff,
      "a job re-offered after the sweep has already failed it is a job that dies waiting",
    ).toBeLessThan(stale);
  });

  it("has no gate left that waits on a daily reset", () => {
    // A reset is hours away; the sweep is thirty minutes. Any wording like
    // this in the dispatcher means the bug is back in a new costume.
    expect(DISPATCH).not.toContain("VOICE_DAILY_CAP");
    expect(DISPATCH).not.toContain("voiceCallsNeeded");
    expect(DISPATCH.toLowerCase()).not.toContain("waits for the pacific-midnight reset");
    expect(
      /dispatched:\s*false[\s\S]{0,200}reset/i.test(DISPATCH),
      "something in the dispatcher still parks a job until a periodic reset",
    ).toBe(false);
  });

  it("still records what a future ceiling would have to be set from", () => {
    // The ledger stays even though nothing reads it to decide: a ceiling set
    // from measurement beats the one that was guessed at and then guarded the
    // wrong meter after voices moved to the Lovable gateway.
    const voice = root("supabase/functions/story-voice/index.ts");
    expect(voice).toContain("api_budget");
  });
});
