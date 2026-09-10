/**
 * ONIQ HEALTH — the DICOM reader, measured rather than believed.
 *
 * Every fixture here is BUILT, byte by byte, from the standard's own layout —
 * not recorded from a real scan. That is deliberate twice over: a real DICOM
 * carries a real person's name, birth date and accession number and has no
 * business in a repository; and a fixture assembled from the spec exercises
 * the exact shapes the parser claims to handle, including the ones no file on
 * hand happens to use.
 *
 * The limit is stated rather than glossed, because this repo has the receipt
 * for what invented fixtures cost (the UPI entry in CLAUDE.md): **no scanner's
 * real output has been through this.** What these prove is that the parser
 * matches the standard as written here. The gate is a real X-ray from a real
 * machine, and until one has been through, the honest claim is no wider.
 */
import { describe, it, expect } from "vitest";
import {
  isDicom,
  parseDicom,
  dicomDateToIso,
  describeDicomHeader,
  MODALITY_NAMES,
  KNOWN_UNSUPPORTED,
  TRANSFER_SYNTAXES,
  READ_TAGS,
  MAX_SUMMARY_CHARS,
} from "../../../supabase/functions/_shared/health/dicom";
import {
  renderDicom,
  firstFragment,
  encodeGrayPng,
  chooseWindow,
} from "../../../supabase/functions/_shared/health/dicomRender";

/* ------------------------------------------------------------- builders -- */

function ascii(s: string): Uint8Array {
  // DICOM string values are padded to an even length with a space.
  const padded = s.length % 2 === 0 ? s : s + " ";
  return new TextEncoder().encode(padded);
}

type Element = { group: number; element: number; vr: string; value: Uint8Array };

function el(tag: string, vr: string, value: Uint8Array | string | number): Element {
  const [g, e] = tag.split(",").map((h) => parseInt(h, 16));
  let bytes: Uint8Array;
  if (typeof value === "string") bytes = ascii(value);
  else if (typeof value === "number") {
    bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
  } else bytes = value;
  return { group: g, element: e, vr, value: bytes };
}

const LONG_VRS = new Set(["OB", "OW", "OF", "OL", "OD", "SQ", "UT", "UN", "UC", "UR"]);

function encodeExplicit(e: Element): Uint8Array {
  const long = LONG_VRS.has(e.vr);
  const head = new Uint8Array(long ? 12 : 8);
  const v = new DataView(head.buffer);
  v.setUint16(0, e.group, true);
  v.setUint16(2, e.element, true);
  head[4] = e.vr.charCodeAt(0);
  head[5] = e.vr.charCodeAt(1);
  if (long) v.setUint32(8, e.value.length, true);
  else v.setUint16(6, e.value.length, true);
  const out = new Uint8Array(head.length + e.value.length);
  out.set(head, 0);
  out.set(e.value, head.length);
  return out;
}

function encodeImplicit(e: Element): Uint8Array {
  const head = new Uint8Array(8);
  const v = new DataView(head.buffer);
  v.setUint16(0, e.group, true);
  v.setUint16(2, e.element, true);
  v.setUint32(4, e.value.length, true);
  const out = new Uint8Array(8 + e.value.length);
  out.set(head, 0);
  out.set(e.value, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A whole file: 128-byte preamble, "DICM", the 0002 meta group, then the dataset. */
function buildDicom(opts: {
  transferSyntax: string;
  dataset: Element[];
  implicit?: boolean;
  /** Replaces the encoded PixelData element entirely (for encapsulated fixtures). */
  rawPixelElement?: Uint8Array;
}): Uint8Array {
  const preamble = new Uint8Array(132);
  preamble.set(new TextEncoder().encode("DICM"), 128);

  // TWO meta elements, so the fixture proves the scan walks PAST one rather
  // than stopping at the first. Both are group 0002 and both are explicit VR,
  // which is what the standard requires of the meta group whatever the dataset
  // uses. An earlier draft of this fixture put SOPClassUID (0008,0016) here —
  // group 0008, a DATASET tag — and the parser refused the file rather than
  // misreading it, which is how the mistake surfaced. MediaStorageSOPClassUID
  // (0002,0002) is the meta-group element that actually belongs.
  const meta = concat([
    encodeExplicit(el("0002,0002", "UI", "1.2.840.10008.5.1.4.1.1.1")),
    encodeExplicit(el(READ_TAGS.transferSyntax, "UI", opts.transferSyntax)),
  ]);

  const encode = opts.implicit ? encodeImplicit : encodeExplicit;
  const body = concat(opts.dataset.map(encode));
  return concat([preamble, meta, body, opts.rawPixelElement ?? new Uint8Array(0)]);
}

/** 16-bit little-endian pixel payload. */
function pixels16(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const v = new DataView(out.buffer);
  values.forEach((n, i) => v.setUint16(i * 2, n, true));
  return out;
}

/** An encapsulated PixelData element: undefined length, empty BOT, one fragment. */
function encapsulatedPixelData(fragment: Uint8Array): Uint8Array {
  const head = new Uint8Array(12);
  const hv = new DataView(head.buffer);
  hv.setUint16(0, 0x7fe0, true);
  hv.setUint16(2, 0x0010, true);
  head[4] = "O".charCodeAt(0);
  head[5] = "B".charCodeAt(0);
  hv.setUint32(8, 0xffffffff, true); // undefined length

  const bot = new Uint8Array(8); // empty Basic Offset Table item
  const bv = new DataView(bot.buffer);
  bv.setUint32(0, 0xe000fffe, true);
  bv.setUint32(4, 0, true);

  const item = new Uint8Array(8 + fragment.length);
  const iv = new DataView(item.buffer);
  iv.setUint32(0, 0xe000fffe, true);
  iv.setUint32(4, fragment.length, true);
  item.set(fragment, 8);

  const delim = new Uint8Array(8);
  const dv = new DataView(delim.buffer);
  dv.setUint32(0, 0xe0ddfffe, true);
  dv.setUint32(4, 0, true);

  return concat([head, bot, item, delim]);
}

/** A 2x2 uncompressed study, explicit VR little endian. */
function tinyStudy(over: Partial<Record<string, Element>> = {}, implicit = false): Uint8Array {
  const base: Element[] = [
    el(READ_TAGS.studyDate, "DA", "20260901"),
    el(READ_TAGS.modality, "CS", "CR"),
    el(READ_TAGS.studyDescription, "LO", "CHEST PA"),
    el(READ_TAGS.bodyPart, "CS", "CHEST"),
    el(READ_TAGS.rows, "US", 2),
    el(READ_TAGS.columns, "US", 2),
    el(READ_TAGS.samplesPerPixel, "US", 1),
    el(READ_TAGS.photometric, "CS", "MONOCHROME2"),
    el(READ_TAGS.bitsAllocated, "US", 16),
    el(READ_TAGS.bitsStored, "US", 16),
    el(READ_TAGS.pixelRepresentation, "US", 0),
    el(READ_TAGS.pixelData, "OW", pixels16([0, 100, 200, 300])),
  ];
  const merged = base.map((e) => {
    const key = Object.entries(READ_TAGS).find(([, tag]) => {
      const [g, x] = tag.split(",").map((h) => parseInt(h, 16));
      return g === e.group && x === e.element;
    })?.[0];
    return key && over[key] ? over[key]! : e;
  });
  for (const [key, e] of Object.entries(over)) {
    const tag = (READ_TAGS as Record<string, string>)[key];
    if (!tag) continue;
    const [g, x] = tag.split(",").map((h) => parseInt(h, 16));
    if (!merged.some((m) => m.group === g && m.element === x)) merged.push(e!);
  }
  return buildDicom({
    transferSyntax: implicit ? "1.2.840.10008.1.2" : "1.2.840.10008.1.2.1",
    dataset: merged,
    implicit,
  });
}

/* --------------------------------------------------------------- tests -- */

describe("DICOM magic", () => {
  it("finds DICM at offset 128 and nowhere else", () => {
    expect(isDicom(tinyStudy())).toBe(true);
    expect(isDicom(new TextEncoder().encode("DICM"))).toBe(false);
    expect(isDicom(new Uint8Array(200))).toBe(false);
    // Short reads must not throw — this runs on a bounded head.
    expect(isDicom(new Uint8Array(4))).toBe(false);
    expect(isDicom(new Uint8Array(0))).toBe(false);
  });
});

describe("parseDicom — explicit VR little endian", () => {
  it("reads the header a person would recognise", () => {
    const r = parseDicom(tinyStudy());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.header.modality).toBe("CR");
    expect(r.header.modalityLabel).toBe("X-ray");
    expect(r.header.studyDate).toBe("2026-09-01");
    expect(r.header.description).toBe("CHEST PA");
    expect(r.header.bodyPart).toBe("CHEST");
    expect(r.header.rows).toBe(2);
    expect(r.header.columns).toBe(2);
    expect(r.header.bitsAllocated).toBe(16);
    expect(r.header.encapsulated).toBe(false);
    expect(r.header.transferSyntaxName).toBe("Explicit VR Little Endian");
  });

  it("reads implicit VR too — the dataset's syntax comes from the meta group", () => {
    const r = parseDicom(tinyStudy({}, true));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.header.rows).toBe(2);
    expect(r.header.columns).toBe(2);
    expect(r.header.modality).toBe("CR");
    expect(r.header.transferSyntaxName).toBe("Implicit VR Little Endian");
  });
});

describe("parseDicom — refusals name the thing they refused", () => {
  it("refuses a file that is not DICOM at all", () => {
    const r = parseDicom(new TextEncoder().encode("%PDF-1.4 hello"));
    expect(r).toEqual({ ok: false, reason: "not_dicom" });
  });

  it("names JPEG 2000 rather than saying 'unsupported'", () => {
    const f = buildDicom({ transferSyntax: "1.2.840.10008.1.2.4.90", dataset: [] });
    const r = parseDicom(f);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unsupported_transfer_syntax");
    expect(r.detail).toBe("JPEG 2000 Lossless");
  });

  it("names an unknown syntax by its UID, so the refusal is still actionable", () => {
    const f = buildDicom({ transferSyntax: "1.2.840.10008.1.2.9.99", dataset: [] });
    const r = parseDicom(f);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).toBe("1.2.840.10008.1.2.9.99");
  });

  it("refuses a study with no pixel data", () => {
    const f = buildDicom({
      transferSyntax: "1.2.840.10008.1.2.1",
      dataset: [el(READ_TAGS.rows, "US", 2), el(READ_TAGS.columns, "US", 2)],
    });
    expect(parseDicom(f)).toMatchObject({ ok: false, reason: "no_pixel_data" });
  });

  it("refuses a study whose dimensions are absent", () => {
    const f = buildDicom({
      transferSyntax: "1.2.840.10008.1.2.1",
      dataset: [el(READ_TAGS.pixelData, "OW", pixels16([1, 2, 3, 4]))],
    });
    expect(parseDicom(f)).toMatchObject({ ok: false, reason: "unsupported_pixel_format" });
  });

  it("does not spin or throw on a truncated file, at any cut", () => {
    const full = tinyStudy();
    for (let cut = 130; cut < full.length; cut += 3) {
      expect(() => parseDicom(full.subarray(0, cut))).not.toThrow();
    }
  });

  it("does not throw on random bytes carrying the magic", () => {
    const junk = new Uint8Array(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 37) % 256;
    junk.set(new TextEncoder().encode("DICM"), 128);
    expect(() => parseDicom(junk)).not.toThrow();
  });
});

describe("the identifiers this parser refuses to read", () => {
  it("READ_TAGS names no patient identifier", () => {
    // The minimum-necessary rule as a list. Patient name (0010,0010), id
    // (0010,0020), birth date (0010,0030), accession (0008,0050) and the
    // referring physician (0008,0090) are all absent ON PURPOSE — ONIQ knows
    // whose file this is from the JWT, and a second identity claim read off an
    // uploaded file would live outside the purge.
    const tags = Object.values(READ_TAGS);
    for (const forbidden of ["0010,0010", "0010,0020", "0010,0030", "0008,0050", "0008,0090"]) {
      expect(tags).not.toContain(forbidden);
    }
  });

  it("a patient name in the file never reaches the header", () => {
    const withName = buildDicom({
      transferSyntax: "1.2.840.10008.1.2.1",
      dataset: [
        el("0010,0010", "PN", "DOE^JANE"),
        el("0010,0020", "LO", "MRN12345"),
        el(READ_TAGS.rows, "US", 2),
        el(READ_TAGS.columns, "US", 2),
        el(READ_TAGS.bitsAllocated, "US", 16),
        el(READ_TAGS.pixelData, "OW", pixels16([1, 2, 3, 4])),
      ],
    });
    const r = parseDicom(withName);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serialised = JSON.stringify(r.header);
    expect(serialised).not.toContain("DOE");
    expect(serialised).not.toContain("JANE");
    expect(serialised).not.toContain("MRN12345");
  });
});

describe("dates and labels", () => {
  it("converts DICOM dates to ISO and refuses nonsense", () => {
    expect(dicomDateToIso("20260901")).toBe("2026-09-01");
    expect(dicomDateToIso("20261301")).toBeNull(); // month 13
    expect(dicomDateToIso("20260132")).toBeNull(); // day 32
    expect(dicomDateToIso("2026-09-01")).toBeNull();
    expect(dicomDateToIso("")).toBeNull();
  });

  it("describes the header without ever stating a finding", () => {
    const r = parseDicom(tinyStudy());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = describeDicomHeader(r.header);
    expect(line).toContain("X-ray");
    expect(line).toContain("chest");
    expect(line).toContain("2026-09-01");
    // It is a summary of the header, never a reading of the image.
    expect(line).not.toMatch(/normal|abnormal|no acute|consolidation|effusion|fracture/i);
  });

  it("bounds and flattens what the FILE wrote, because nothing in the format does", () => {
    // A StudyDescription is an LO, and a file is free to put anything in it:
    // newlines, tabs, NULs, or a megabyte of text. This string becomes the
    // document's TITLE (documents.confirm) and the image's ALT TEXT, so an
    // unbounded one eats the list and reads back as a paragraph to a screen
    // reader. React escapes markup, so the risk is legibility, not injection —
    // which is exactly why it would otherwise go unnoticed.
    const wild = `CHEST\r\n\tPA\u0000 ${"very ".repeat(200)}long`;
    const r = parseDicom(
      tinyStudy({ studyDescription: el(READ_TAGS.studyDescription, "LO", wild) }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The header itself keeps what the file said — the bound belongs on the
    // way OUT, so nothing here quietly rewrites the person's own file.
    expect(r.header.description).toContain("very very");
    const line = describeDicomHeader(r.header);
    expect(line.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    expect(line).not.toMatch(/[\r\n\t\u0000]/);
    expect(line).toContain("X-ray");
    expect(line).toContain("2026-09-01");
  });

  it("falls back to the raw modality code rather than inventing a name", () => {
    const f = tinyStudy({ modality: el(READ_TAGS.modality, "CS", "ZZ") });
    const r = parseDicom(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.header.modalityLabel).toBe("ZZ");
    expect(MODALITY_NAMES.ZZ).toBeUndefined();
  });
});

describe("rendering — the JPEG passthrough", () => {
  it("hands back the fragment's bytes EXACTLY, with no decode", async () => {
    // A recognisable payload standing in for a JPEG bitstream. The point of
    // the passthrough is that these bytes are not touched.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]);
    const f = buildDicom({
      transferSyntax: "1.2.840.10008.1.2.4.50",
      dataset: [
        el(READ_TAGS.rows, "US", 2),
        el(READ_TAGS.columns, "US", 2),
        el(READ_TAGS.bitsAllocated, "US", 8),
      ],
      rawPixelElement: encapsulatedPixelData(jpeg),
    });
    const parsed = parseDicom(f);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.header.encapsulated).toBe(true);

    const r = await renderDicom(f, parsed.header);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.method).toBe("jpeg_passthrough");
    expect(r.image.mime).toBe("image/jpeg");
    expect(Array.from(r.image.bytes)).toEqual(Array.from(jpeg));
  });

  it("skips the empty Basic Offset Table and takes the first real frame", () => {
    const frame = new Uint8Array([9, 8, 7]);
    const encapsulated = encapsulatedPixelData(frame);
    // The element header is 12 bytes; fragments start after it.
    const got = firstFragment(encapsulated, 12, encapsulated.length - 12);
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual([9, 8, 7]);
  });

  it("returns a COPY, never a window onto the whole upload", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 42, 0xff, 0xd9, 0]);
    const f = buildDicom({
      transferSyntax: "1.2.840.10008.1.2.4.50",
      dataset: [
        el(READ_TAGS.rows, "US", 1),
        el(READ_TAGS.columns, "US", 1),
        el(READ_TAGS.bitsAllocated, "US", 8),
      ],
      rawPixelElement: encapsulatedPixelData(jpeg),
    });
    const parsed = parseDicom(f);
    if (!parsed.ok) throw new Error("fixture did not parse");
    const r = await renderDicom(f, parsed.header);
    if (!r.ok) throw new Error("render failed");
    expect(r.image.bytes.byteLength).toBe(r.image.bytes.buffer.byteLength);
  });
});

describe("rendering — windowed PNG", () => {
  async function renderTiny(over: Partial<Record<string, Element>> = {}) {
    const f = tinyStudy(over);
    const parsed = parseDicom(f);
    if (!parsed.ok) throw new Error(`fixture did not parse: ${parsed.reason}`);
    const r = await renderDicom(f, parsed.header);
    if (!r.ok) throw new Error(`render failed: ${r.reason}`);
    return { r, header: parsed.header };
  }

  it("produces a real PNG: signature, dimensions, and a decodable IHDR", async () => {
    const { r } = await renderTiny();
    expect(r.method).toBe("windowed_png");
    expect(r.image.mime).toBe("image/png");
    const b = r.image.bytes;
    expect(Array.from(b.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(String.fromCharCode(...b.subarray(12, 16))).toBe("IHDR");
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    expect(v.getUint32(16, false)).toBe(2); // width
    expect(v.getUint32(20, false)).toBe(2); // height
    expect(b[24]).toBe(8); // bit depth
    expect(b[25]).toBe(0); // greyscale
    expect(String.fromCharCode(...b.subarray(b.length - 8, b.length - 4))).toBe("IEND");
  });

  it("every chunk's CRC checks out", async () => {
    const { r } = await renderTiny();
    const b = r.image.bytes;
    const table = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
    const crc = (buf: Uint8Array) => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 8;
    let chunks = 0;
    while (p < b.length) {
      const len = v.getUint32(p, false);
      const stated = v.getUint32(p + 8 + len, false);
      expect(crc(b.subarray(p + 4, p + 8 + len))).toBe(stated);
      chunks++;
      p += 12 + len;
    }
    expect(chunks).toBe(3); // IHDR, IDAT, IEND
  });

  it("uses the file's window when it carries one, and the data range when it does not", () => {
    const withWindow = {
      transferSyntax: "x",
      windowCenter: 40,
      windowWidth: 400,
    } as unknown as Parameters<typeof chooseWindow>[0];
    expect(chooseWindow(withWindow, -1000, 1000)).toEqual({
      centre: 40,
      width: 400,
      source: "file",
    });

    const noWindow = {
      transferSyntax: "x",
      windowCenter: null,
      windowWidth: null,
    } as unknown as Parameters<typeof chooseWindow>[0];
    // The neutral choice: show everything, favour nothing.
    expect(chooseWindow(noWindow, 0, 300)).toEqual({
      centre: 150,
      width: 300,
      source: "data_range",
    });
  });

  it("a zero-width window in the file is ignored rather than dividing by zero", () => {
    const bad = {
      windowCenter: 40,
      windowWidth: 0,
    } as unknown as Parameters<typeof chooseWindow>[0];
    expect(chooseWindow(bad, 0, 100).source).toBe("data_range");
  });

  it("MONOCHROME1 inverts — getting this wrong is a plausible-looking negative", async () => {
    // Same pixels, both photometric interpretations. Decode the PNGs' pixel
    // rows and assert the greys are mirrored, which is the only way to catch
    // an inversion that still produces a perfectly valid file.
    const normal = await renderTiny();
    const inverted = await renderTiny({
      photometric: el(READ_TAGS.photometric, "CS", "MONOCHROME1"),
    });
    const grays = async (bytes: Uint8Array) => {
      const idatStart = 8 + 25; // signature + IHDR chunk
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const len = v.getUint32(idatStart, false);
      const z = bytes.subarray(idatStart + 8, idatStart + 8 + len);
      const ds = new DecompressionStream("deflate");
      const w = ds.writable.getWriter();
      void w.write(new Uint8Array(z));
      void w.close();
      const out: number[] = [];
      const rd = ds.readable.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        out.push(...value);
      }
      // Drop the per-row filter byte (2x2 image, so 3 bytes per row).
      return [out[1], out[2], out[4], out[5]];
    };
    const a = await grays(normal.r.image.bytes);
    const b = await grays(inverted.r.image.bytes);
    expect(a).not.toEqual(b);
    expect(b).toEqual(a.map((g) => 255 - g));
  });

  it("applies rescale slope and intercept before the window", async () => {
    // Stored 0..300 with intercept -1000 becomes -1000..-700 Hounsfield. With
    // no window in the file the data range is used, so the PNG must still span
    // the full 0..255 — proving the rescale did not push everything off-scale.
    const { r } = await renderTiny({
      rescaleIntercept: el(READ_TAGS.rescaleIntercept, "DS", "-1000"),
      rescaleSlope: el(READ_TAGS.rescaleSlope, "DS", "1"),
    });
    const b = r.image.bytes;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const len = v.getUint32(33, false);
    const z = b.subarray(41, 41 + len);
    const ds = new DecompressionStream("deflate");
    const w = ds.writable.getWriter();
    void w.write(new Uint8Array(z));
    void w.close();
    const out: number[] = [];
    const rd = ds.readable.getReader();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      out.push(...value);
    }
    expect(out[1]).toBe(0);
    expect(out[5]).toBe(255);
  });

  it("refuses when the declared dimensions need more bytes than the file carries", async () => {
    const f = tinyStudy({
      rows: el(READ_TAGS.rows, "US", 512),
      columns: el(READ_TAGS.columns, "US", 512),
    });
    const parsed = parseDicom(f);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = await renderDicom(f, parsed.header);
    expect(r).toMatchObject({ ok: false, reason: "pixel_data_mismatch" });
  });

  it("refuses colour and exotic bit depths by name rather than guessing", async () => {
    const rgb = tinyStudy({ samplesPerPixel: el(READ_TAGS.samplesPerPixel, "US", 3) });
    const parsedRgb = parseDicom(rgb);
    if (!parsedRgb.ok) throw new Error("fixture did not parse");
    const r1 = await renderDicom(rgb, parsedRgb.header);
    expect(r1).toMatchObject({ ok: false, reason: "unsupported_pixel_format" });
    if (!r1.ok) expect(r1.detail).toContain("3 samples");

    const deep = tinyStudy({ bitsAllocated: el(READ_TAGS.bitsAllocated, "US", 32) });
    const parsedDeep = parseDicom(deep);
    if (!parsedDeep.ok) throw new Error("fixture did not parse");
    const r2 = await renderDicom(deep, parsedDeep.header);
    expect(r2).toMatchObject({ ok: false, reason: "unsupported_pixel_format" });
    if (!r2.ok) expect(r2.detail).toContain("32-bit");
  });
});

describe("the PNG encoder on its own", () => {
  it("round-trips a gradient through deflate", async () => {
    const w = 16;
    const h = 4;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) gray[i] = (i * 4) % 256;
    const png = await encodeGrayPng(gray, w, h);
    const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(v.getUint32(16, false)).toBe(w);
    expect(v.getUint32(20, false)).toBe(h);

    const len = v.getUint32(33, false);
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    void writer.write(new Uint8Array(png.subarray(41, 41 + len)));
    void writer.close();
    const out: number[] = [];
    const reader = ds.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(...value);
    }
    expect(out.length).toBe((w + 1) * h);
    for (let y = 0; y < h; y++) {
      expect(out[y * (w + 1)]).toBe(0); // filter byte
      expect(out.slice(y * (w + 1) + 1, (y + 1) * (w + 1))).toEqual(
        Array.from(gray.subarray(y * w, (y + 1) * w)),
      );
    }
  });
});

describe("the supported set is a closed list", () => {
  it("every supported syntax names a pixel strategy, and passthrough names a mime", () => {
    for (const [uid, s] of Object.entries(TRANSFER_SYNTAXES)) {
      expect(uid).toMatch(/^1\.2\.840\.10008\./);
      expect(["raw", "passthrough"]).toContain(s.pixels);
      if (s.pixels === "passthrough") {
        expect((s as { passthroughMime?: string }).passthroughMime).toBe("image/jpeg");
      }
    }
  });

  it("supported and known-unsupported never overlap", () => {
    for (const uid of Object.keys(TRANSFER_SYNTAXES)) {
      expect(KNOWN_UNSUPPORTED[uid]).toBeUndefined();
    }
  });
});
