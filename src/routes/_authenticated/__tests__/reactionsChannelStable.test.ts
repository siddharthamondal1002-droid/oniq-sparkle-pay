/**
 * The reactions realtime channel must NOT churn per message.
 *
 * THE DEFECT THIS PINS
 *
 * The `reactions:${conversationId}` channel effect used to list `messageIds` in
 * its dependency array. messageIds is `messages.map(m => m.id)` — a fresh array
 * on every message change — so every incoming message (and every optimistic
 * send / refetch) tore the channel down (removeChannel) and re-subscribed it: a
 * realtime subscribe/unsubscribe round-trip per message, with a window in which
 * reaction events arriving mid-resubscribe were dropped. messageIds was only in
 * the deps so the handler could filter events to on-screen messages.
 *
 * The fix keeps the on-screen id set in a ref (reactionMsgIdsRef, updated by its
 * own effect) and reads it inside the handler, so the channel subscribes ONCE
 * per conversation. Asserted against source because the churn is a
 * dependency-array behaviour a node test cannot observe through the realtime
 * client.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/app.chat.$conversationId.tsx"),
  "utf8",
);

// Isolate the reactions channel effect: from the channel string to its deps.
const start = src.indexOf("`reactions:${conversationId}`");
const effect = src.slice(start, src.indexOf("];", start) + 2);

describe("reactions channel is stable per conversation", () => {
  it("subscribes and cleans up (removeChannel) exactly once per conversation", () => {
    expect(start).toBeGreaterThan(-1);
    expect(effect).toContain(".subscribe()");
    expect(src.slice(start, start + 1200)).toContain("supabase.removeChannel(ch)");
  });

  it("does NOT list messageIds in the reactions effect deps (no per-message churn)", () => {
    // The dep array closing the effect must not re-run on messageIds.
    const depsLine = src.slice(start).match(/\},\s*\[[^\]]*\]\);/);
    expect(depsLine).not.toBeNull();
    expect(depsLine![0]).not.toMatch(/messageIds/);
    expect(depsLine![0]).toMatch(/conversationId/);
  });

  it("filters incoming events through the ref, not a captured messageIds set", () => {
    expect(src).toContain("reactionMsgIdsRef.current.has(mid)");
    expect(src).toMatch(/reactionMsgIdsRef\s*=\s*useRef/);
  });
});
