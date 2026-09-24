import { describe, expect, it } from "vitest";
import { CallIceBuffer } from "@/lib/callIceBuffer";

describe("ICE candidates arriving before peer setup", () => {
  it("delivers candidates to the correct peer when its offer creates a connection", () => {
    const pending = new CallIceBuffer();
    const first = { candidate: "candidate:1" };
    const second = { candidate: "candidate:2" };
    pending.add("alice", first);
    pending.add("bob", second);

    expect(pending.take("alice")).toEqual([first]);
    expect(pending.take("alice")).toEqual([]);
    expect(pending.take("bob")).toEqual([second]);
  });

  it("bounds a delayed peer's queue and discards it when the call ends", () => {
    const pending = new CallIceBuffer();
    for (let i = 0; i < 70; i++) pending.add("alice", { candidate: `candidate:${i}` });
    const candidates = pending.take("alice");
    expect(candidates).toHaveLength(64);
    expect(candidates[0].candidate).toBe("candidate:6");

    pending.add("alice", { candidate: "stale" });
    pending.clear();
    expect(pending.take("alice")).toEqual([]);
  });

  it("does not retain unlimited unknown senders on a broadcast channel", () => {
    const pending = new CallIceBuffer();
    for (let i = 0; i < 129; i++) pending.add(`peer-${i}`, { candidate: `candidate:${i}` });
    expect(pending.take("peer-0")).toEqual([]);
    expect(pending.take("peer-128")).toEqual([{ candidate: "candidate:128" }]);
  });
});
