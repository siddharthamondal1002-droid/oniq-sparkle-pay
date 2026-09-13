/**
 * The half a node test cannot execute: that each button hands the binding ITS
 * OWN film's id, and that the screen keeps no second copy of the logic.
 *
 * Comments are stripped first — the header of YourVideos.tsx and the binding
 * itself both QUOTE the retired surface comparison to explain why it is gone,
 * and a guard that reads the explanation would pass on the very shape it
 * exists to catch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "@/test/sourceText";

const SCREEN = stripComments(readFileSync("src/components/stories/YourVideos.tsx", "utf8"));

describe("the buttons are bound to a film, not to a surface", () => {
  it("never decides anything from ready.surface", () => {
    expect(SCREEN).not.toMatch(/ready\?\.surface\s*===/);
    expect(SCREEN).not.toMatch(/ready\.surface\s*===/);
  });

  it("the saved row compares its own id", () => {
    expect(SCREEN).toContain("readySavedId === v.id");
    expect(SCREEN).toContain('sendNow({ kind: "saved", id: v.id })');
  });

  it("the open film compares its own id", () => {
    expect(SCREEN).toContain('sameSource(ready.source, { kind: "film", id: openId })');
    expect(SCREEN).toContain('sendNow({ kind: "film", id: openId })');
  });

  it("holds no copy of the binding's state", () => {
    // The armed file, the stale-fetch ticket and the send guard all live in
    // shareBinding.ts. A useState for any of them here is a second source of
    // truth that will disagree with the first.
    expect(SCREEN).not.toMatch(/useState<ReadyShare/);
    expect(SCREEN).not.toContain("prepareSeq");
    expect(SCREEN).toContain("createShareBinding()");
  });

  it("still calls the sheet with nothing awaited in front of it", () => {
    const binding = stripComments(readFileSync("src/components/stories/shareBinding.ts", "utf8"));
    const body = binding.slice(binding.indexOf("sendNow(source"));
    // No await between entering sendNow and handing the file over.
    expect(body.slice(0, body.indexOf("io.send("))).not.toContain("await");
    expect(body).not.toMatch(/async\s+sendNow/);
  });
});
