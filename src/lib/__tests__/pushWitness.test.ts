/**
 * THE WITNESS HAS TO CARRY THE FIELD THAT SEPARATES THE TWO FAULTS.
 *
 * `send-push` answers `sent: 0` for two completely different reasons:
 *
 *   nobody had a push address  -> it returns `unaddressed: N` and never
 *                                 reaches FCM. The fault is REGISTRATION.
 *   it did address somebody    -> no `unaddressed` field, and nothing
 *                                 arrived anyway. The fault is TRANSPORT.
 *
 * Both are a 200, and `push.ts` writes the same "accepted but sent 0" row for
 * either. On 2026-09-07, 44 such rows were read to answer exactly that
 * question and could not: the report built its detail from three named fields
 * and `unaddressed` was dropped before it was ever written. An absent field
 * then reads as positive evidence of the other branch — and an agent did read
 * it that way, and was wrong.
 *
 * So this pins the whole chain: the function returns it, the client's type
 * admits it, and the report records it. Break any link and the next outage is
 * as unanswerable as this one was.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
/** Comments quote every one of these names, so prose must go first. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const FN = codeOnly(readFileSync(join(ROOT, "supabase/functions/send-push/index.ts"), "utf8"));
const CLIENT = codeOnly(readFileSync(join(ROOT, "src/lib/push.ts"), "utf8"));

describe("a 'sent 0' row says WHICH kind of nothing happened", () => {
  it("send-push reports how many recipients it could not address", () => {
    expect(FN, "the server stopped counting unaddressed recipients").toContain(
      "unaddressed: recipientIds.length",
    );
  });

  it("the client's response type admits the field, or it is dropped on read", () => {
    // A field absent from the cast is not merely unread — it cannot reach the
    // report below, which is precisely how it went missing.
    const cast = CLIENT.slice(CLIENT.indexOf("const d = data as"));
    expect(cast.slice(0, 220)).toContain("unaddressed");
  });

  it("the report writes it, so the row can be read back", () => {
    const report = CLIENT.slice(CLIENT.indexOf('"accepted but sent 0"'));
    expect(report.slice(0, 400)).toContain("unaddressed: d?.unaddressed ?? null");
  });
});
