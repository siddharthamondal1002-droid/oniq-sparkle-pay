/**
 * THE CHAT'S VISUAL CONSTANTS, PINNED.
 *
 * Asked for 2026-08-18 against a reference screenshot: calmer surfaces, type
 * big enough to read at arm's length, and a composer that is a rounded card
 * rather than a lozenge. None of that is expressible as a token — it is a
 * handful of numbers scattered through a 4,100-line file, which is exactly the
 * kind of thing that gets undone by the next person tidying a class string.
 *
 * The background is deliberately NOT covered here. The doodle paper stays as
 * it is by explicit instruction, and a guard on it would only invite someone
 * to "fix" the ground while chasing a bubble.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CHAT = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/app.chat.$conversationId.tsx"),
  "utf8",
);

/** Code only — the comments here quote old values in order to explain them. */
const CODE = CHAT.split("\n")
  .filter((l) => {
    const t = l.trimStart();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");

describe("message bubbles read at arm's length", () => {
  it("body type is 16/23, not the old 15/21", () => {
    // Both the live bubble and the "message was deleted" one, so the two
    // cannot drift apart — they sit next to each other in a thread.
    expect(CODE, "the bubble body type shrank again").toContain("text-[16px] leading-[23px]");
    expect(CODE).toContain("text-[16px] italic leading-[23px]");
  });

  it("the radius grew with the padding it rounds", () => {
    expect(CODE, "bubble radius is back to 18px").toContain('"rounded-[20px]"');
    expect(CODE, "the grouped-corner collapse is back to 6px").toContain("rounded-tr-[7px]");
    expect(CODE).toContain("px-3.5 py-2.5");
  });

  it("carries one soft shadow rather than two stacked ones", () => {
    // Two shadows over patterned paper read as grime around the bubble edge,
    // which is the specific thing the reference does not do.
    expect(CODE, "the stacked double shadow is back on the bubbles").not.toContain(
      "shadow-[0_1px_1px_rgba(0,0,0,0.28),0_1px_3px_rgba(0,0,0,0.22)]",
    );
  });
});

describe("the composer is a card, not a pill", () => {
  it("the input shell is a 22px rounded rectangle", () => {
    const shell = CODE.match(/relative flex flex-1 items-center gap-2 ([^"]*)/)?.[1] ?? "";
    expect(shell, "the composer shell went back to rounded-full").toContain("rounded-[22px]");
    expect(shell).not.toContain("rounded-full");
  });

  it("the field's own type is 15px", () => {
    // Smaller than a message on purpose: what you are composing should not
    // out-shout what you have received.
    expect(CODE, "the composer input shrank back to text-sm").toContain(
      "flex-1 bg-transparent py-3 text-[15px]",
    );
  });
});
