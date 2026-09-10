/**
 * ONIQ HEALTH — turning a DICOM's pixels into something a phone can show.
 * Owner directive 2026-09-10, "B and C"; this is still B, and it still
 * interprets nothing. It changes the ENCODING of an image and never its
 * meaning.
 *
 * TWO PATHS, AND THE FIRST ONE IS THE POINT. The pixel data of a
 * JPEG-encapsulated DICOM **is a JPEG** — the standard wraps the compressed
 * bitstream in fragments and changes not one byte of it. So for the syntaxes
 * a lot of X-ray exports actually use, the whole "render" is: find the
 * fragment, hand back its bytes, say `image/jpeg`. No decoder, no colour
 * maths, no CPU, and no chance of a decoding bug in the function that holds
 * the service role. Reach for the passthrough before writing a decoder.
 *
 * The second path is for uncompressed pixels, where there is real work:
 * 16-bit stored values are not brightness. They are scanner units — Hounsfield
 * for CT — and turning them into grey needs the rescale (slope/intercept) and
 * then the WINDOW the scanner recorded. A chest CT windowed for bone and the
 * same slice windowed for lung look like different images, which is why the
 * window is read from the file rather than picked here: choosing a window is
 * choosing what is visible, and that is a radiographer's decision, not this
 * file's. When the file carries none, the fallback is the actual min/max of
 * the data — the neutral choice, not a clinical one.
 *
 * MONOCHROME1 IS INVERTED and forgetting it produces a photographic negative
 * that looks plausible and is wrong — bone black, air white. It is one line
 * and it is the single easiest way to make this file quietly harmful.
 *
 * THE PNG ENCODER IS HERE FOR THE SAME REASON THE PARSER IS: no dependency.
 * Deno's `CompressionStream("deflate")` emits exactly the zlib-wrapped stream
 * PNG's IDAT wants, so the encoder is a header, a CRC and three chunks.
 */
import { type DicomHeader, TRANSFER_SYNTAXES } from "./dicom.ts";

export type RenderedImage = { mime: "image/jpeg" | "image/png"; bytes: Uint8Array };

export type RenderFailure =
  "unsupported_pixel_format" | "no_pixel_data" | "pixel_data_mismatch" | "image_too_large";

export type DicomRender =
  | {
      ok: true;
      image: RenderedImage;
      method: "jpeg_passthrough" | "windowed_png";
      /** The rendered size. For a passthrough this is the header's, unverified against the JPEG. */
      width: number;
      height: number;
      /** Set only when the preview was shrunk; the stored original is untouched. */
      downscaledFrom: { width: number; height: number } | null;
    }
  | { ok: false; reason: RenderFailure; detail?: string };

/** Item and sequence-delimiter tags of an encapsulated pixel-data stream. */
const ITEM_TAG = 0xe000fffe;
const SEQ_DELIM_TAG = 0xe0ddfffe;

/** A rendered preview is capped here so one file cannot exhaust the isolate. */
export const MAX_RENDER_BYTES = 24 * 1024 * 1024;

/**
 * The longest side of a rendered preview. A phone shows far less than a chest
 * radiograph's native 2–3k pixels, and the preview travels base64 inside a
 * JSON response — at native size a single CT slice would be a multi-megabyte
 * string for no visible gain.
 */
export const PREVIEW_MAX_DIMENSION = 1600;

/**
 * Encapsulated pixel data is: an optional Basic Offset Table item (usually
 * empty), then one item per frame. The FIRST non-empty item is frame one,
 * which is the frame ONIQ shows — a multi-frame file gets its first frame and
 * says so, rather than silently showing a middle slice as if it were the study.
 */
export function firstFragment(
  bytes: Uint8Array,
  offset: number,
  length: number,
): Uint8Array | null {
  const end = Math.min(bytes.length, offset + length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = offset;
  let guard = 0;
  while (p + 8 <= end && guard < 1000) {
    guard++;
    const tag = view.getUint32(p, true);
    const itemLength = view.getUint32(p + 4, true);
    if (tag === SEQ_DELIM_TAG) return null;
    if (tag !== ITEM_TAG) return null;
    const from = p + 8;
    const to = from + itemLength;
    if (to > end) return null;
    // The Basic Offset Table is an item too, and an empty one; skip it and
    // take the first item that actually carries a frame.
    if (itemLength > 0) return bytes.subarray(from, to);
    p = to;
  }
  return null;
}

/** CRC-32, the PNG flavour. Table built once. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const forCrc = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(forCrc), false);
  return out;
}

async function deflate(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  // "deflate" is zlib-wrapped in the Compression Streams spec, which is what
  // PNG's IDAT requires — "deflate-raw" would produce a file no decoder reads.
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  void writer.write(raw);
  void writer.close();
  const parts: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** 8-bit greyscale PNG. `gray` is width*height bytes, row-major. */
export async function encodeGrayPng(
  gray: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  // Each scanline is prefixed with its filter byte; 0 means "none", which
  // costs a little size and removes a whole class of encoder bug.
  const filtered = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (width + 1)] = 0;
    filtered.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const idat = await deflate(filtered);

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width, false);
  iv.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type 0 = greyscale
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The window to map through, and where it came from. Exported because the
 * choice is the interesting part and a test should be able to state it.
 */
export type Window = { centre: number; width: number; source: "file" | "data_range" };

export function chooseWindow(h: DicomHeader, min: number, max: number): Window {
  if (h.windowCenter !== null && h.windowWidth !== null && h.windowWidth > 0) {
    return { centre: h.windowCenter, width: h.windowWidth, source: "file" };
  }
  // No window in the file: use the data's own range. This is the neutral
  // choice — it shows everything the pixels contain and favours nothing.
  const width = Math.max(1, max - min);
  return { centre: min + width / 2, width, source: "data_range" };
}

/** Read the stored values as numbers, honouring bit depth and signedness. */
function readSamples(
  bytes: Uint8Array,
  offset: number,
  count: number,
  bitsAllocated: number,
  signed: boolean,
): Int32Array | null {
  const out = new Int32Array(count);
  if (bitsAllocated === 8) {
    if (offset + count > bytes.length) return null;
    for (let i = 0; i < count; i++) {
      const v = bytes[offset + i];
      out[i] = signed ? (v << 24) >> 24 : v;
    }
    return out;
  }
  if (bitsAllocated === 16) {
    if (offset + count * 2 > bytes.length) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < count; i++) {
      const at = offset + i * 2;
      out[i] = signed ? view.getInt16(at, true) : view.getUint16(at, true);
    }
    return out;
  }
  return null;
}

export async function renderDicom(
  bytes: Uint8Array,
  h: DicomHeader,
  maxDimension: number = PREVIEW_MAX_DIMENSION,
): Promise<DicomRender> {
  const syntax = (
    TRANSFER_SYNTAXES as Record<string, { pixels: string; passthroughMime?: string }>
  )[h.transferSyntax];
  if (!syntax) return { ok: false, reason: "unsupported_pixel_format", detail: h.transferSyntax };

  if (syntax.pixels === "passthrough") {
    const frag = firstFragment(bytes, h.pixelDataOffset, h.pixelDataLength);
    if (!frag || frag.length === 0) return { ok: false, reason: "no_pixel_data" };
    if (frag.length > MAX_RENDER_BYTES) {
      return { ok: false, reason: "image_too_large", detail: `${frag.length} bytes` };
    }
    // The fragment is a complete JPEG; it is copied rather than returned as a
    // view so the caller cannot be handed a window onto the whole upload.
    // NOT DOWNSCALED, and not decoded to find out its real size: the whole
    // value of this path is that no decoder runs. The dimensions reported are
    // the HEADER's, which is what the scanner wrote; if a file ever disagreed
    // with its own header the image would still be correct and only the number
    // beside it wrong.
    return {
      ok: true,
      image: { mime: "image/jpeg", bytes: frag.slice() },
      method: "jpeg_passthrough",
      width: h.columns,
      height: h.rows,
      downscaledFrom: null,
    };
  }

  if (h.samplesPerPixel !== 1) {
    return {
      ok: false,
      reason: "unsupported_pixel_format",
      detail: `${h.samplesPerPixel} samples per pixel`,
    };
  }
  if (h.bitsAllocated !== 8 && h.bitsAllocated !== 16) {
    return { ok: false, reason: "unsupported_pixel_format", detail: `${h.bitsAllocated}-bit` };
  }

  const count = h.rows * h.columns;
  if (count * (h.bitsAllocated / 8) > MAX_RENDER_BYTES) {
    return { ok: false, reason: "image_too_large", detail: `${h.columns}x${h.rows}` };
  }
  const samples = readSamples(bytes, h.pixelDataOffset, count, h.bitsAllocated, h.signed);
  if (!samples) {
    return {
      ok: false,
      reason: "pixel_data_mismatch",
      detail: `${h.columns}x${h.rows} needs more bytes than the file carries`,
    };
  }

  // Rescale to the scanner's real units BEFORE windowing — for CT that is the
  // difference between Hounsfield units and raw stored values, and the window
  // in the file is expressed in the rescaled units.
  const slope = h.rescaleSlope;
  const intercept = h.rescaleIntercept;
  let min = Infinity;
  let max = -Infinity;
  const scaled = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const v = samples[i] * slope + intercept;
    scaled[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const win = chooseWindow(h, min, max);
  const low = win.centre - win.width / 2;
  const invert = h.photometric === "MONOCHROME1";

  const gray = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    let t = (scaled[i] - low) / win.width;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const g = Math.round(t * 255);
    gray[i] = invert ? 255 - g : g;
  }

  // DOWNSAMPLE FOR THE PREVIEW, and say so rather than pretending otherwise.
  // This is what a person looks at on a phone; the ORIGINAL is untouched in
  // the bucket and `documents.url` hands back a signed link to every byte of
  // it, which is the copy that matters if anyone ever takes it to a
  // radiologist. Windowing before scaling is deliberate — averaging raw
  // Hounsfield units and windowing afterwards blurs across the window edge and
  // invents grey that was never in the data.
  const scaledOut = downscale(gray, h.columns, h.rows, maxDimension);
  const png = await encodeGrayPng(scaledOut.gray, scaledOut.width, scaledOut.height);
  return {
    ok: true,
    image: { mime: "image/png", bytes: png },
    method: "windowed_png",
    width: scaledOut.width,
    height: scaledOut.height,
    downscaledFrom:
      scaledOut.width === h.columns && scaledOut.height === h.rows
        ? null
        : { width: h.columns, height: h.rows },
  };
}

/**
 * Nearest-neighbour, because it is the only resampler that invents no pixel
 * value. A bilinear average would produce greys that appear in no voxel of the
 * study — fine for a photograph, not for something a person may squint at
 * looking for a hairline crack. Cheap is a side benefit; honest is the reason.
 */
export function downscale(
  gray: Uint8Array,
  width: number,
  height: number,
  maxDimension: number,
): { gray: Uint8Array; width: number; height: number } {
  const longest = Math.max(width, height);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0 || longest <= maxDimension) {
    return { gray, width, height };
  }
  const factor = maxDimension / longest;
  const w = Math.max(1, Math.round(width * factor));
  const h = Math.max(1, Math.round(height * factor));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / w));
      out[y * w + x] = gray[sy * width + sx];
    }
  }
  return { gray: out, width: w, height: h };
}

/**
 * Chunked, because `String.fromCharCode(...bytes)` on a multi-megabyte image
 * spreads every byte into one argument list and blows the call stack — the
 * same reason `bytesToBase64` in the Vertex provider is chunked. This copy
 * exists rather than an import because that one lives in the AI tree, and
 * health-api reaching into it would drag a model provider into the function
 * that must stay model-free (`ai/isolation.test.ts` asserts exactly that).
 */
export function imageToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
