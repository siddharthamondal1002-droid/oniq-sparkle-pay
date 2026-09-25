/**
 * A CALL THAT NEVER SIGNALLED MUST NOT LOOK LIKE A CALL THE OTHER SIDE IGNORED.
 *
 * Measured on production 2026-09-25, from `client_error_reports`: eight
 * `call-connect-timeout` rows between 2026-08-15 and 2026-09-19, and five of
 * them byte-identical apart from the timestamp —
 *
 *     {"role":"callee","detail":[],"callType":"video",
 *      "tally":{"helloTx":10,"helloRx":0,"offerRx":0,"answerRx":0},
 *      "media":true,"state":"connecting","peers":[]}
 *
 * Ten hellos out, none back, no peer connection, camera open. The tally's own
 * header invited the reading "the other side's acceptance never arrived", and
 * that was wrong: `helloTx` was incremented one line ABOVE
 * `channelRef.current?.send(...)`, which does nothing when the channel is
 * null. Nothing was ever sent.
 *
 * The channel is null whenever `meId` is undefined, because the signaling
 * effect returns at its first line. Every dispatcher of `oniq:start-call`
 * passes `meId: me?.id` from its own react-query and GlobalCallHost falls back
 * to another one; the value is frozen into the session at mount and the
 * overlay's `key` does not change when `me` later resolves.
 *
 * Two guards, then: the overlay resolves its own id, and the tally stops
 * counting sends that did not happen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const SRC = readFileSync(join(process.cwd(), "src/components/chat/CallOverlay.tsx"), "utf8");
/*
 * Comments stripped, and it is load-bearing here rather than a habit: the
 * prose added with this fix quotes `helloTx`, `channelRef.current?.send`,
 * `sendsDropped` and `meId` repeatedly, precisely to explain them. A guard
 * that read the explanation would pass on the very shape it exists to catch.
 */
const CODE = stripComments(SRC);

/** The body of a top-level `const <name> = (` … `};` declaration, by brace count. */
function bodyOf(name: string): string {
  const start = CODE.indexOf(`const ${name} = (`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const open = CODE.indexOf("{", CODE.indexOf("=>", start));
  let depth = 0;
  for (let i = open; i < CODE.length; i++) {
    if (CODE[i] === "{") depth += 1;
    else if (CODE[i] === "}") {
      depth -= 1;
      if (depth === 0) return CODE.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated body for ${name}`);
}

describe("the overlay resolves its own identity", () => {
  it("takes the caller-supplied id as a hint, not as the only source", () => {
    expect(CODE).toMatch(/meId:\s*meIdProp/);
  });

  it("falls back to the authenticated user when no id was passed in", () => {
    expect(CODE).toMatch(/supabase\.auth\s*\.?\s*\n?\s*\.getUser\(\)/);
    expect(CODE).toMatch(/setResolvedMeId\(/);
  });

  it("uses the resolved id everywhere the prop used to be read", () => {
    // `meId` is what the signaling effect guards on, what `isOffererFor`
    // compares and what every payload's `from` carries. Binding it to the
    // resolved value is what makes one fallback cover all of them.
    expect(CODE).toMatch(/const meId = resolvedMeId;/);
  });

  it("reports whether it had an identity when a call times out", () => {
    expect(CODE).toMatch(/haveMeId:\s*!!meId/);
  });
});

describe("the handshake tally counts sends, not attempts", () => {
  const BODY = bodyOf("sendSig");

  it("refuses to send when there is no channel, before counting anything", () => {
    const guard = BODY.indexOf("if (!ch)");
    const count = BODY.indexOf("helloTx");
    expect(guard, "sendSig no longer guards on a missing channel").toBeGreaterThan(-1);
    expect(count, "sendSig no longer counts hellos").toBeGreaterThan(-1);
    expect(guard, "helloTx is counted before the channel is known to exist").toBeLessThan(count);
  });

  it("never reaches the optional-call form that made a missing channel silent", () => {
    expect(BODY).not.toMatch(/channelRef\.current\?\./);
  });

  it("counts a signal it could not send", () => {
    expect(BODY).toMatch(/sendsDropped\s*\+=\s*1/);
  });

  it("counts a signal the channel did not acknowledge", () => {
    // `send` resolves "ok" | "timed out" | "error"; a timeout loses the
    // signal exactly as completely, and just as quietly, as a null channel.
    expect(BODY).toMatch(/res !== "ok"/);
    expect(BODY).toMatch(/sendsFailed\s*\+=\s*1/);
  });

  it("carries both losses and the channel's existence into the timeout report", () => {
    expect(CODE).toMatch(/sendsDropped:\s*0/);
    expect(CODE).toMatch(/sendsFailed:\s*0/);
    expect(CODE).toMatch(/hasChannel:\s*!!channelRef\.current/);
  });
});
