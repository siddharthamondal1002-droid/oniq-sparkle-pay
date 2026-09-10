/**
 * ONIQ HEALTH — DICOM, read on ONIQ's side. Owner directive 2026-09-10, "B and C";
 * this file is B, and B interprets NOTHING.
 *
 * WHY THIS PARSES BY HAND RATHER THAN IMPORTING A LIBRARY. Three DICOM
 * packages exist on npm and any of them would work. None is imported, for
 * reasons that are specific to this tree rather than general taste:
 *
 *   - The health isolation guard admits ONE npm specifier (`npm:unpdf`) in ONE
 *     file and fails on a second (`ai/isolation.test.ts`, mutation-checked by
 *     `scripts/health-mutate-guards.sh`). Widening that allowlist is a real
 *     cost — it is the thing standing between the health tree and an egress
 *     path — and a header parse does not justify paying it.
 *   - This runs inside the function that holds the SERVICE ROLE, on a file a
 *     stranger uploaded. Every byte of parsing surface here is attack surface,
 *     and 300 auditable lines beat a transitive tree nobody in this repo has
 *     read.
 *   - It stays testable in vitest with no `package.json` change, which matters
 *     because Lovable owns that file and every dependency is a round trip.
 *
 * WHAT IT READS AND WHAT IT REFUSES. The meta header (group 0002) is ALWAYS
 * explicit VR little endian by the standard, whatever the dataset that follows
 * uses; it names the transfer syntax, and the transfer syntax decides
 * everything after. Anything this file does not understand is refused BY NAME
 * — `refusal.detail` carries the UID — because "we cannot read this scan" with
 * no reason is the shape of bug that gets re-uploaded five times at cost.
 *
 * IT IS BOUNDED, deliberately and in three ways: the bucket's 10 MiB, a
 * `MAX_ELEMENTS` walk so a malformed length cannot spin, and a refusal to
 * follow any offset outside the buffer. A DICOM file is a length-prefixed
 * format read from an untrusted source, which is the classic shape for a
 * parser that runs forever on four crafted bytes.
 */

/** "DICM" sits at byte 128, after a 128-byte preamble that carries no meaning. */
export const DICOM_MAGIC_OFFSET = 128;
export const DICOM_MAGIC = "DICM";

/** A malformed file cannot spin: the walk stops here whatever the lengths say. */
export const MAX_ELEMENTS = 20000;

/**
 * The transfer syntaxes this file understands, and what each means for the
 * pixels. `passthrough` is the elegant case: the pixel data of a
 * JPEG-encapsulated DICOM IS a JPEG, so it is served as one with no decoding
 * at all — no decoder, no bug, no CPU.
 */
export const TRANSFER_SYNTAXES = {
  "1.2.840.10008.1.2": { name: "Implicit VR Little Endian", explicit: false, pixels: "raw" },
  "1.2.840.10008.1.2.1": { name: "Explicit VR Little Endian", explicit: true, pixels: "raw" },
  "1.2.840.10008.1.2.4.50": {
    name: "JPEG Baseline",
    explicit: true,
    pixels: "passthrough",
    passthroughMime: "image/jpeg",
  },
  "1.2.840.10008.1.2.4.51": {
    name: "JPEG Extended",
    explicit: true,
    pixels: "passthrough",
    passthroughMime: "image/jpeg",
  },
} as const;

export type TransferSyntaxUid = keyof typeof TRANSFER_SYNTAXES;

/**
 * Named so a refusal can say which one, rather than "unsupported". Every entry
 * is a syntax a real scanner emits; JPEG 2000 in particular is what a lot of
 * modern CT exports use, and telling someone that is far more useful than a
 * shrug.
 */
export const KNOWN_UNSUPPORTED: Record<string, string> = {
  "1.2.840.10008.1.2.2": "Explicit VR Big Endian",
  "1.2.840.10008.1.2.5": "RLE Lossless",
  "1.2.840.10008.1.2.4.57": "JPEG Lossless",
  "1.2.840.10008.1.2.4.70": "JPEG Lossless, First-Order Prediction",
  "1.2.840.10008.1.2.4.80": "JPEG-LS Lossless",
  "1.2.840.10008.1.2.4.81": "JPEG-LS Near-Lossless",
  "1.2.840.10008.1.2.4.90": "JPEG 2000 Lossless",
  "1.2.840.10008.1.2.4.91": "JPEG 2000",
  "1.2.840.10008.1.2.4.92": "JPEG 2000 Part 2 Lossless",
  "1.2.840.10008.1.2.4.93": "JPEG 2000 Part 2",
};

/**
 * The tags read, and NO others. This is the minimum-necessary rule the health
 * tree applies everywhere else, applied to a file format: a DICOM header
 * carries the patient's name, id, birth date, the accession number, the
 * referring physician and the institution, and ONIQ reads NONE of them. It
 * already knows whose document this is — the JWT proved it — so reading an
 * identifier off the file would add a second, unverified claim about identity
 * and put it somewhere the purge does not reach.
 */
export const READ_TAGS = {
  transferSyntax: "0002,0010",
  modality: "0008,0060",
  studyDate: "0008,0020",
  studyDescription: "0008,1030",
  seriesDescription: "0008,103E",
  bodyPart: "0018,0015",
  rows: "0028,0010",
  columns: "0028,0011",
  samplesPerPixel: "0028,0002",
  photometric: "0028,0004",
  bitsAllocated: "0028,0100",
  bitsStored: "0028,0101",
  pixelRepresentation: "0028,0103",
  windowCenter: "0028,1050",
  windowWidth: "0028,1051",
  rescaleIntercept: "0028,1052",
  rescaleSlope: "0028,1053",
  numberOfFrames: "0028,0008",
  pixelData: "7FE0,0010",
} as const;

/** Modality codes worth naming in plain language; anything else shows its code. */
export const MODALITY_NAMES: Record<string, string> = {
  CR: "X-ray",
  DX: "X-ray",
  CT: "CT scan",
  MR: "MRI",
  US: "Ultrasound",
  MG: "Mammogram",
  NM: "Nuclear medicine",
  PT: "PET scan",
  XA: "Angiogram",
  RF: "Fluoroscopy",
  OT: "Other",
  SR: "Structured report",
};

export type DicomRefusal =
  | "not_dicom"
  | "truncated"
  | "unsupported_transfer_syntax"
  | "no_pixel_data"
  | "unsupported_pixel_format"
  | "image_too_large";

export type DicomHeader = {
  transferSyntax: string;
  /** The transfer syntax's human name when known, else the UID itself. */
  transferSyntaxName: string;
  modality: string | null;
  /** MODALITY_NAMES[modality] when known, else the raw code, else null. */
  modalityLabel: string | null;
  studyDate: string | null;
  description: string | null;
  bodyPart: string | null;
  rows: number;
  columns: number;
  samplesPerPixel: number;
  photometric: string | null;
  bitsAllocated: number;
  bitsStored: number;
  signed: boolean;
  windowCenter: number | null;
  windowWidth: number | null;
  rescaleIntercept: number;
  rescaleSlope: number;
  frames: number;
  /** Where the pixels are, in the ORIGINAL buffer. */
  pixelDataOffset: number;
  pixelDataLength: number;
  /** True when the pixel data is encapsulated in fragments (a compressed syntax). */
  encapsulated: boolean;
};

export type DicomParse =
  { ok: true; header: DicomHeader } | { ok: false; reason: DicomRefusal; detail?: string };

/** The magic check, on a bounded head — the same shape as `sniffMime`. */
export function isDicom(head: Uint8Array): boolean {
  if (head.length < DICOM_MAGIC_OFFSET + 4) return false;
  for (let i = 0; i < 4; i++) {
    if (head[DICOM_MAGIC_OFFSET + i] !== DICOM_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

function tagKey(group: number, element: number): string {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
  return `${hex(group)},${hex(element)}`;
}

/**
 * VRs whose length field is 32-bit with two reserved bytes between. The rest
 * carry a 16-bit length immediately after the two VR characters.
 */
const LONG_FORM_VRS = new Set(["OB", "OW", "OF", "OL", "OD", "SQ", "UT", "UN", "UC", "UR"]);

/** Trailing NUL or space is the standard's own padding to an even length. */
function trimDicomString(s: string): string {
  return s.replace(/[\0 ]+$/, "").trim();
}

/** "YYYYMMDD" is how DICOM writes a date; ONIQ writes ISO everywhere else. */
export function dicomDateToIso(raw: string): string | null {
  const s = trimDicomString(raw);
  if (!/^\d{8}$/.test(s)) return null;
  const [y, m, d] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)];
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${m}-${d}`;
}

/** DICOM may carry several window values as "a\b"; the first is the one to use. */
function firstNumber(raw: string): number | null {
  const first = trimDicomString(raw).split("\\")[0];
  const n = Number(first);
  return Number.isFinite(n) ? n : null;
}

/**
 * Walk the elements and collect only READ_TAGS. Returns raw values; the header
 * is assembled by the caller so that every coercion is in one place and
 * testable.
 *
 * The walk stops at PixelData rather than reading it: the pixels are the
 * largest part of the file by far, and nothing here needs them in memory —
 * the renderer is handed the original buffer and the offset.
 */
function walk(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  explicit: boolean,
  stopAtPixelData: boolean,
): { found: Map<string, { offset: number; length: number; vr: string }>; truncated: boolean } {
  const found = new Map<string, { offset: number; length: number; vr: string }>();
  let p = start;
  let seen = 0;
  const wanted = new Set<string>(Object.values(READ_TAGS));

  while (p + 8 <= bytes.length && seen < MAX_ELEMENTS) {
    seen++;
    const group = view.getUint16(p, true);
    const element = view.getUint16(p + 2, true);
    const key = tagKey(group, element);
    let vr = "";
    let length = 0;
    let valueAt = 0;

    if (explicit) {
      vr = String.fromCharCode(bytes[p + 4], bytes[p + 5]);
      if (LONG_FORM_VRS.has(vr)) {
        if (p + 12 > bytes.length) return { found, truncated: true };
        length = view.getUint32(p + 8, true);
        valueAt = p + 12;
      } else {
        length = view.getUint16(p + 6, true);
        valueAt = p + 8;
      }
    } else {
      if (p + 8 > bytes.length) return { found, truncated: true };
      length = view.getUint32(p + 4, true);
      valueAt = p + 8;
      vr = "";
    }

    // 0xFFFFFFFF is "undefined length": a sequence or encapsulated pixel data.
    // For PixelData that is the encapsulated case and the caller handles it;
    // for a sequence the only safe move without a full SQ parser is to stop,
    // because the items that follow are not elements at this level.
    const undefinedLength = length === 0xffffffff;

    if (key === READ_TAGS.pixelData) {
      found.set(key, {
        offset: valueAt,
        length: undefinedLength ? bytes.length - valueAt : length,
        vr: undefinedLength ? "ENCAPSULATED" : vr,
      });
      if (stopAtPixelData) return { found, truncated: false };
    } else if (wanted.has(key) && !undefinedLength) {
      if (valueAt + length > bytes.length) return { found, truncated: true };
      found.set(key, { offset: valueAt, length, vr });
    }

    if (undefinedLength && key !== READ_TAGS.pixelData) return { found, truncated: false };
    if (length < 0 || valueAt + length > bytes.length) {
      return { found, truncated: key !== READ_TAGS.pixelData };
    }
    // Every element length is even by the standard; an odd one is corruption,
    // and rounding up rather than trusting it is what keeps the walk aligned.
    p = valueAt + length + (length % 2);
  }
  return { found, truncated: false };
}

/** The largest image this will render, in pixels — a bound on the work, not on medicine. */
export const MAX_IMAGE_PIXELS = 40_000_000;

export function parseDicom(bytes: Uint8Array): DicomParse {
  if (!isDicom(bytes)) return { ok: false, reason: "not_dicom" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (at: { offset: number; length: number }) =>
    trimDicomString(new TextDecoder().decode(bytes.subarray(at.offset, at.offset + at.length)));

  // The meta header (group 0002) is explicit VR little endian ALWAYS, by the
  // standard, whatever the dataset uses. Read it first; it names the rest.
  const meta = walk(bytes, view, DICOM_MAGIC_OFFSET + 4, true, false).found;
  const tsAt = meta.get(READ_TAGS.transferSyntax);
  if (!tsAt) return { ok: false, reason: "truncated", detail: "no transfer syntax" };
  const transferSyntax = str(tsAt);

  const known = (TRANSFER_SYNTAXES as Record<string, { explicit: boolean }>)[transferSyntax];
  if (!known) {
    const name = KNOWN_UNSUPPORTED[transferSyntax] ?? transferSyntax;
    return { ok: false, reason: "unsupported_transfer_syntax", detail: name };
  }

  // The dataset begins after the meta group. Find where 0002 stops rather than
  // trusting the group-length element, which is optional and often wrong.
  let dataStart = DICOM_MAGIC_OFFSET + 4;
  {
    let p = dataStart;
    let seen = 0;
    while (p + 8 <= bytes.length && seen < MAX_ELEMENTS) {
      seen++;
      if (view.getUint16(p, true) !== 0x0002) break;
      const vr = String.fromCharCode(bytes[p + 4], bytes[p + 5]);
      const long = LONG_FORM_VRS.has(vr);
      const length = long ? view.getUint32(p + 8, true) : view.getUint16(p + 6, true);
      const valueAt = long ? p + 12 : p + 8;
      if (valueAt + length > bytes.length) return { ok: false, reason: "truncated" };
      p = valueAt + length + (length % 2);
      dataStart = p;
    }
  }

  const found = walk(bytes, view, dataStart, known.explicit, true).found;
  const text = (tag: string): string | null => {
    const at = found.get(tag);
    if (!at) return null;
    const v = str(at);
    return v.length > 0 ? v : null;
  };
  const int = (tag: string, fallback: number): number => {
    const at = found.get(tag);
    if (!at) return fallback;
    // US/UL come as binary; IS comes as a decimal string. The VR says which,
    // and an implicit-VR file has no VR at all — so the length decides.
    if (at.vr === "US" && at.length >= 2) return view.getUint16(at.offset, true);
    if (at.vr === "UL" && at.length >= 4) return view.getUint32(at.offset, true);
    const n = firstNumber(str(at));
    if (n !== null) return n;
    if (at.length === 2) return view.getUint16(at.offset, true);
    if (at.length === 4) return view.getUint32(at.offset, true);
    return fallback;
  };
  const dec = (tag: string, fallback: number): number => {
    const at = found.get(tag);
    if (!at) return fallback;
    const n = firstNumber(str(at));
    return n === null ? fallback : n;
  };

  const pixels = found.get(READ_TAGS.pixelData);
  if (!pixels || pixels.length <= 0) return { ok: false, reason: "no_pixel_data" };

  const rows = int(READ_TAGS.rows, 0);
  const columns = int(READ_TAGS.columns, 0);
  if (rows <= 0 || columns <= 0) {
    return { ok: false, reason: "unsupported_pixel_format", detail: "no image dimensions" };
  }
  if (rows * columns > MAX_IMAGE_PIXELS) {
    return { ok: false, reason: "image_too_large", detail: `${columns}x${rows}` };
  }

  const modality = text(READ_TAGS.modality);
  const studyDateRaw = text(READ_TAGS.studyDate);

  return {
    ok: true,
    header: {
      transferSyntax,
      transferSyntaxName:
        (TRANSFER_SYNTAXES as Record<string, { name: string }>)[transferSyntax]?.name ??
        transferSyntax,
      modality,
      modalityLabel: modality ? (MODALITY_NAMES[modality] ?? modality) : null,
      studyDate: studyDateRaw ? dicomDateToIso(studyDateRaw) : null,
      description: text(READ_TAGS.studyDescription) ?? text(READ_TAGS.seriesDescription),
      bodyPart: text(READ_TAGS.bodyPart),
      rows,
      columns,
      samplesPerPixel: int(READ_TAGS.samplesPerPixel, 1),
      photometric: text(READ_TAGS.photometric),
      bitsAllocated: int(READ_TAGS.bitsAllocated, 16),
      bitsStored: int(READ_TAGS.bitsStored, 0) || int(READ_TAGS.bitsAllocated, 16),
      signed: int(READ_TAGS.pixelRepresentation, 0) === 1,
      windowCenter: found.has(READ_TAGS.windowCenter) ? dec(READ_TAGS.windowCenter, 0) : null,
      windowWidth: found.has(READ_TAGS.windowWidth) ? dec(READ_TAGS.windowWidth, 0) : null,
      rescaleIntercept: dec(READ_TAGS.rescaleIntercept, 0),
      rescaleSlope: dec(READ_TAGS.rescaleSlope, 1) || 1,
      frames: Math.max(1, int(READ_TAGS.numberOfFrames, 1)),
      pixelDataOffset: pixels.offset,
      pixelDataLength: pixels.length,
      encapsulated: pixels.vr === "ENCAPSULATED",
    },
  };
}

/** The longest a single header string may contribute to a summary line. */
export const MAX_SUMMARY_FIELD_CHARS = 60;
/** The longest a whole summary line may be — under `MAX_TITLE_CHARS` (120). */
export const MAX_SUMMARY_CHARS = 110;

/**
 * A header string on its way to a screen or a document title. THE FILE WROTE
 * THESE, so they are untrusted text of unbounded length: nothing in the format
 * stops a StudyDescription being a megabyte, or carrying newlines, tabs and
 * control characters that would break the one line this is meant to be. React
 * escapes markup, so the risk here is not injection — it is a title that eats
 * the list and a summary that is no longer a summary.
 */
function summaryField(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = raw
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > MAX_SUMMARY_FIELD_CHARS
    ? `${flat.slice(0, MAX_SUMMARY_FIELD_CHARS - 1)}…`
    : flat;
}

/**
 * A one-line summary of what the file IS, for the document title and the
 * screen. It names the modality, the body part and the date and NOTHING a
 * radiologist would call a finding — a summary of the header is not a reading
 * of the image, and this file must never blur that line.
 */
export function describeDicomHeader(h: DicomHeader): string {
  const bits = [summaryField(h.modalityLabel ?? "") || "Scan"];
  const bodyPart = h.bodyPart ? summaryField(h.bodyPart).toLowerCase() : "";
  if (bodyPart) bits.push(bodyPart);
  const description = h.description ? summaryField(h.description) : "";
  if (description) bits.push(`— ${description}`);
  if (h.studyDate) bits.push(`(${h.studyDate})`);
  const line = bits.join(" ");
  return line.length > MAX_SUMMARY_CHARS ? `${line.slice(0, MAX_SUMMARY_CHARS - 1)}…` : line;
}
