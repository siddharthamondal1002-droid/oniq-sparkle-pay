/**
 * The share binding, executed rather than read.
 *
 * These are the four faults the surface-only version shipped with: preparing
 * one film armed every row, a slow fetch armed the film you had moved away
 * from, a deleted film left an armed button, and two taps both reached the
 * sheet. Every one of them is driven here through the real module the screen
 * uses — there is no second copy of this logic in the component.
 *
 * THE LIMIT, STATED: this repo's vitest environment is "node" with no DOM and
 * no renderer, so what is not covered is the JSX wiring — that the button for
 * row B passes B's own id. That is asserted structurally in
 * shareBindingWiring.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { createShareBinding, sameSource, type ShareIo } from "../shareBinding";

const fileFor = (name: string) => new File([new Uint8Array(4)], name, { type: "video/mp4" });

/** A prepare whose completion the test decides, so overlap is real. */
function deferredIo() {
  const pending: { name: string; resolve: (f: File) => void }[] = [];
  const sent: File[] = [];
  let settle: (o: "shared") => void = () => {};
  const io: ShareIo = {
    prepare: ((_url: string, name: string) =>
      new Promise((res) => {
        pending.push({ name, resolve: (file) => res({ kind: "ready", file }) });
      })) as ShareIo["prepare"],
    send: ((file: File) => {
      sent.push(file);
      return new Promise<"shared">((res) => {
        settle = res;
      });
    }) as unknown as ShareIo["send"],
  };
  return { io, pending, sent, finishSend: () => settle("shared") };
}

const args = (kind: "film" | "saved", id: string) => ({
  source: { kind, id } as const,
  surface: kind === "film" ? "share-video" : "share-saved-video",
  url: `https://x/${id}.mp4`,
  fileName: `${id}.mp4`,
  whenFailed: "failed",
  whenUnsupported: "unsupported",
});

describe("a prepared file belongs to one film", () => {
  it("arms only its own source", async () => {
    const { io, pending } = deferredIo();
    const b = createShareBinding(io);
    const p = b.prepare(args("saved", "A"));
    pending[0].resolve(fileFor("A.mp4"));
    await p;

    expect(sameSource(b.getSnapshot().ready?.source, { kind: "saved", id: "A" })).toBe(true);
    expect(sameSource(b.getSnapshot().ready?.source, { kind: "saved", id: "B" })).toBe(false);
    // Same id, other kind, is NOT the same film.
    expect(sameSource(b.getSnapshot().ready?.source, { kind: "film", id: "A" })).toBe(false);
  });

  it("refuses to send A from B's button, and sends nothing", async () => {
    const { io, pending, sent } = deferredIo();
    const b = createShareBinding(io);
    const p = b.prepare(args("saved", "A"));
    pending[0].resolve(fileFor("A.mp4"));
    await p;

    expect(b.sendNow({ kind: "saved", id: "B" }, () => {})).toBe(false);
    expect(sent).toEqual([]);
    // A's own button still works.
    expect(b.sendNow({ kind: "saved", id: "A" }, () => {})).toBe(true);
    expect(sent.map((f) => f.name)).toEqual(["A.mp4"]);
  });
});

describe("prepare A, then choose B", () => {
  it("never arms A once B has been started", async () => {
    const { io, pending } = deferredIo();
    const b = createShareBinding(io);
    const pA = b.prepare(args("saved", "A"));
    const pB = b.prepare(args("saved", "B"));
    // A's fetch lands LAST — the out-of-order case that armed the wrong film.
    pending[1].resolve(fileFor("B.mp4"));
    pending[0].resolve(fileFor("A.mp4"));
    await Promise.all([pA, pB]);

    expect(b.getSnapshot().ready?.source).toEqual({ kind: "saved", id: "B" });
    expect(b.getSnapshot().ready?.file.name).toBe("B.mp4");
  });

  it("reports the superseded prepare as no outcome at all", async () => {
    const { io, pending } = deferredIo();
    const b = createShareBinding(io);
    const pA = b.prepare(args("saved", "A"));
    const pB = b.prepare(args("saved", "B"));
    pending[1].resolve(fileFor("B.mp4"));
    pending[0].resolve(fileFor("A.mp4"));
    const [rA, rB] = await Promise.all([pA, pB]);

    expect(rA).toEqual({ outcome: null });
    expect(rB).toEqual({ armed: true });
  });
});

describe("one send at a time", () => {
  it("a second tap while the sheet is open sends nothing extra", async () => {
    const { io, pending, sent, finishSend } = deferredIo();
    const b = createShareBinding(io);
    const p = b.prepare(args("film", "F"));
    pending[0].resolve(fileFor("F.mp4"));
    await p;

    expect(b.sendNow({ kind: "film", id: "F" }, () => {})).toBe(true);
    expect(b.sendNow({ kind: "film", id: "F" }, () => {})).toBe(false);
    expect(sent).toHaveLength(1);

    finishSend();
    await Promise.resolve();
  });

  it("disarms and reports the outcome when the sheet closes", async () => {
    const { io, pending, finishSend } = deferredIo();
    const b = createShareBinding(io);
    const p = b.prepare(args("film", "F"));
    pending[0].resolve(fileFor("F.mp4"));
    await p;

    const onOutcome = vi.fn();
    b.sendNow({ kind: "film", id: "F" }, onOutcome);
    finishSend();
    await Promise.resolve();
    await Promise.resolve();

    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome.mock.calls[0][1]).toBe("shared");
    expect(b.getSnapshot().ready).toBeNull();
  });
});

describe("an armed file does not outlive its film", () => {
  it.each(["film", "saved"] as const)(
    "discards a pending %s when its source disappears",
    async (kind) => {
      const { io, pending, sent } = deferredIo();
      const b = createShareBinding(io);
      const p = b.prepare(args(kind, "A"));
      b.invalidate("B", ["B"]);
      pending[0].resolve(fileFor("A.mp4"));
      expect(await p).toEqual({ outcome: null });
      expect(b.getSnapshot().ready).toBeNull();
      expect(b.getSnapshot().sharing).toBe(false);
      expect(b.sendNow({ kind, id: "A" }, () => {})).toBe(false);
      expect(sent).toEqual([]);
    },
  );

  it("drops when the open film is closed or swapped", async () => {
    const { io, pending } = deferredIo();
    const b = createShareBinding(io);
    const p = b.prepare(args("film", "F"));
    pending[0].resolve(fileFor("F.mp4"));
    await p;

    b.invalidate("F", []);
    expect(b.getSnapshot().ready).not.toBeNull();
    b.invalidate("OTHER", []);
    expect(b.getSnapshot().ready).toBeNull();
  });

  it("drops when the saved film leaves the phone", async () => {
    const { io, pending } = deferredIo();
    const b = createShareBinding(io);
    const p = b.prepare(args("saved", "A"));
    pending[0].resolve(fileFor("A.mp4"));
    await p;

    b.invalidate(null, ["A", "B"]);
    expect(b.getSnapshot().ready).not.toBeNull();
    b.invalidate(null, ["B"]);
    expect(b.getSnapshot().ready).toBeNull();
  });
});
