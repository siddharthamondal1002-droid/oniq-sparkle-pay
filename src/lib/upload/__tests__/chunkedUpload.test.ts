/**
 * Track A4 — the upload logic, exercised for real.
 *
 * Unlike the guard suites elsewhere in this repo, these are not source
 * assertions: the module is pure with the network injected, so every case
 * below actually RUNS the code. That is the point of the shape — the bugs
 * worth catching here (resume arithmetic, a short final part, a signature
 * check that reads the wrong bytes) are behavioural, and a grep would miss
 * all three.
 *
 * The one thing that still cannot be checked from here is the failure this
 * module exists to prevent: a 200 MB whole-file read killing the process on a
 * mid-range phone. That reproduces on hardware and nowhere else. What IS
 * checked is that the file is only ever sliced, which is the mechanism.
 */
import { describe, expect, it, vi } from "vitest";
import {
  MAGIC_BYTES_TO_READ,
  matchBlockedMagic,
  planParts,
  retryDelayMs,
  screenFile,
  uploadInParts,
  type UploadPart,
} from "@/lib/upload/chunkedUpload";
import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from "@/config/mediaStorage";

const MB = 1024 * 1024;

/**
 * A File stand-in that RECORDS every slice and refuses to be read whole.
 *
 * The refusal is the interesting part: if the code under test ever reaches for
 * arrayBuffer() or text(), the test fails loudly instead of quietly passing on
 * a machine with plenty of RAM.
 */
function fakeFile(size: number) {
  const slices: Array<[number, number]> = [];
  return {
    size,
    slices,
    slice(a: number, b: number) {
      slices.push([a, b]);
      return { __slice: [a, b], size: b - a } as unknown as Blob;
    },
    arrayBuffer() {
      throw new Error("whole-file read — this is the bug the module exists to prevent");
    },
    text() {
      throw new Error("whole-file read — this is the bug the module exists to prevent");
    },
  };
}

describe("parts are planned so the server will accept them", () => {
  it("splits into 5 MB parts numbered from 1", () => {
    const parts = planParts(12 * MB);
    expect(parts[0]).toEqual({ partNumber: 1, start: 0, end: 5 * MB });
    expect(parts[1]).toEqual({ partNumber: 2, start: 5 * MB, end: 10 * MB });
    expect(parts.at(-1)!.end).toBe(12 * MB);
  });

  it("covers the file exactly, with no gap and no overlap", () => {
    for (const size of [1, 5 * MB, 5 * MB + 1, 37 * MB, MAX_UPLOAD_BYTES]) {
      const parts = planParts(size);
      expect(parts[0].start, `size ${size}`).toBe(0);
      expect(parts.at(-1)!.end, `size ${size}`).toBe(size);
      for (let i = 1; i < parts.length; i++) {
        expect(parts[i].start, `gap at ${i} for size ${size}`).toBe(parts[i - 1].end);
      }
    }
  });

  it("never emits a short part except at the very end", () => {
    // S3 and R2 reject any non-final part under 5 MB — and they reject it at
    // COMPLETION, after the whole file has already been uploaded. That is the
    // most expensive possible moment to find out.
    for (const size of [6 * MB, 5 * MB + 1, 11 * MB, 5 * MB + 17]) {
      const parts = planParts(size);
      for (let i = 0; i < parts.length - 1; i++) {
        expect(
          parts[i].end - parts[i].start,
          `short middle part, size ${size}`,
        ).toBeGreaterThanOrEqual(UPLOAD_CHUNK_BYTES);
      }
    }
  });

  it("leaves a tiny final part alone", () => {
    // The first version of planParts merged this into the previous part "to
    // save a request". Wrong twice: the 5 MB minimum explicitly does not
    // apply to the last part, and merging produced parts of up to 2x the
    // chunk size, which defeats having a fixed chunk size for resume at all.
    const parts = planParts(5 * MB + 1);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({ partNumber: 2, start: 5 * MB, end: 5 * MB + 1 });
  });

  it("keeps every part at or under the chunk size", () => {
    // The resume protocol assumes a part is one chunk. An oversized part
    // would make "how far did we get" arithmetic wrong.
    for (const size of [12 * MB, 5 * MB + 1, 37 * MB, MAX_UPLOAD_BYTES]) {
      for (const p of planParts(size)) {
        expect(p.end - p.start, `oversized part for size ${size}`).toBeLessThanOrEqual(
          UPLOAD_CHUNK_BYTES,
        );
      }
    }
  });

  it("returns nothing for an empty or nonsense size", () => {
    for (const bad of [0, -1, Number.NaN]) expect(planParts(bad)).toEqual([]);
  });
});

describe("files are screened by signature, never by name", () => {
  const readHead = (bytes: number[]) => async () => new Uint8Array(bytes);

  it("blocks an APK renamed to look like a photo", () => {
    // 504B0304 is a ZIP container, which is what an APK is. The filename is
    // never consulted, so holiday.jpg gets caught.
    expect(matchBlockedMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x11]))).toMatch(
      /Android|JAR|ZIP/i,
    );
  });

  it("blocks Windows, ELF and shebang payloads", () => {
    expect(matchBlockedMagic(new Uint8Array([0x4d, 0x5a]))).toMatch(/Windows|DOS/i);
    expect(matchBlockedMagic(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).toMatch(/ELF/i);
    expect(matchBlockedMagic(new Uint8Array([0x23, 0x21]))).toMatch(/[Ss]hell|shebang/i);
  });

  it("lets a real JPEG through", () => {
    expect(matchBlockedMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });

  it("reads only the first few bytes, whatever the file size", async () => {
    const f = fakeFile(150 * MB);
    await screenFile(f, readHead([0xff, 0xd8, 0xff, 0xe0]));
    expect(f.slices).toEqual([[0, MAGIC_BYTES_TO_READ]]);
  });

  it("refuses an oversized file WITHOUT reading any of it", async () => {
    // Order matters. Screening the contents of a 2 GB file to then reject it
    // for size would be the exact mistake this module is about.
    const f = fakeFile(MAX_UPLOAD_BYTES + 1);
    const spy = vi.fn(readHead([0xff, 0xd8]));
    const r = await screenFile(f, spy);
    expect(r?.kind).toBe("too-large");
    expect(spy).not.toHaveBeenCalled();
    expect(f.slices).toEqual([]);
  });

  it("accepts exactly the cap and rejects one byte more", async () => {
    const ok = await screenFile(fakeFile(MAX_UPLOAD_BYTES), readHead([0xff, 0xd8]));
    expect(ok).toBeNull();
    const bad = await screenFile(fakeFile(MAX_UPLOAD_BYTES + 1), readHead([0xff, 0xd8]));
    expect(bad?.kind).toBe("too-large");
  });

  it("rejects an empty file", async () => {
    expect((await screenFile(fakeFile(0), readHead([])))?.kind).toBe("empty");
  });

  it("says something a human can act on", async () => {
    const r = await screenFile(fakeFile(MAX_UPLOAD_BYTES + MB), readHead([0xff, 0xd8]));
    expect(r?.kind).toBe("too-large");
    if (r?.kind === "too-large") {
      expect(r.message).toMatch(/201 MB|MB/);
      expect(r.message).toMatch(/200 MB/);
    }
  });
});

describe("uploading slices, retries and resumes", () => {
  const okIo = (log: UploadPart[]) => ({
    putPart: async (p: UploadPart) => {
      log.push(p);
      return `etag-${p.partNumber}`;
    },
  });

  it("sends every part and never reads the file whole", async () => {
    const f = fakeFile(12 * MB);
    const log: UploadPart[] = [];
    const out = await uploadInParts(f, okIo(log));
    expect(out.ok).toBe(true);
    expect(log.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    // Every byte read was via slice, and the slices tile the file exactly.
    expect(f.slices[0][0]).toBe(0);
    expect(f.slices.at(-1)![1]).toBe(12 * MB);
  });

  it("skips parts that already landed", async () => {
    // The resume path. Without it a 200 MB upload on mobile data never
    // finishes, because it restarts from zero every time the signal drops.
    const f = fakeFile(15 * MB);
    const log: UploadPart[] = [];
    const out = await uploadInParts(f, {
      ...okIo(log),
      listUploadedParts: async () => [
        { partNumber: 1, etag: "old-1" },
        { partNumber: 2, etag: "old-2" },
      ],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.resumedFrom).toBe(2);
      expect(out.parts.map((p) => p.etag)).toEqual(["old-1", "old-2", "etag-3"]);
    }
    // Only part 3 was actually sent.
    expect(log.map((p) => p.partNumber)).toEqual([3]);
  });

  it("reports progress over the whole file, including resumed bytes", async () => {
    // A progress bar that restarts at 0% after a resume tells the user their
    // upload was thrown away, which is the opposite of what happened.
    const seen: Array<[number, number, number]> = [];
    await uploadInParts(fakeFile(15 * MB), {
      putPart: async (p) => `e${p.partNumber}`,
      listUploadedParts: async () => [{ partNumber: 1, etag: "old" }],
      onProgress: (done, total, bytes) => seen.push([done, total, bytes]),
    });
    expect(seen[0]).toEqual([1, 3, 5 * MB]);
    expect(seen.at(-1)).toEqual([3, 3, 15 * MB]);
  });

  it("retries a flaky part instead of failing the file", async () => {
    // Counting calls, not using a post-increment inside the throw condition.
    // The first draft did the latter and asserted 2, which was wrong: `x++`
    // increments whether or not the comparison passes, so the successful
    // third call bumped it to 3 too.
    const callsForPart1: number[] = [];
    const out = await uploadInParts(
      fakeFile(6 * MB),
      {
        putPart: async (p) => {
          if (p.partNumber === 1) {
            callsForPart1.push(1);
            if (callsForPart1.length <= 2) throw new Error("network");
          }
          return `e${p.partNumber}`;
        },
      },
      { sleep: async () => {} },
    );
    expect(out.ok).toBe(true);
    // Two failures then a success — the part went, the file did not fail.
    expect(callsForPart1).toHaveLength(3);
  });

  it("gives up on one part without discarding the ones already stored", async () => {
    // Everything before the failure stays on the server, so the next attempt
    // resumes there. Failing the whole file would throw that away.
    const out = await uploadInParts(
      fakeFile(15 * MB),
      {
        putPart: async (p) => {
          if (p.partNumber === 2) throw new Error("gone");
          return `e${p.partNumber}`;
        },
      },
      { sleep: async () => {} },
    );
    expect(out.ok).toBe(false);
    if (!out.ok && "failedPart" in out) {
      expect(out.failedPart).toBe(2);
      expect(out.error).toBe("gone");
    }
  });

  it("stops immediately when cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await uploadInParts(fakeFile(15 * MB), okIo([]), { signal: ctrl.signal });
    expect(out.ok).toBe(false);
  });

  it("backs off exponentially with a ceiling", async () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 16000]);
  });

  it("survives a listUploadedParts failure by starting over", async () => {
    // Not being able to ask what landed is worse than knowing, but it is not
    // fatal — it just means paying again. Throwing here would strand the user.
    const log: UploadPart[] = [];
    const out = await uploadInParts(fakeFile(6 * MB), {
      ...okIo(log),
      listUploadedParts: async () => {
        throw new Error("offline");
      },
    });
    expect(out.ok).toBe(true);
    // 6 MB is two parts, and both are re-sent because we could not learn
    // which had already landed.
    expect(log.map((p) => p.partNumber)).toEqual([1, 2]);
  });
});
