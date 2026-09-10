/**
 * A SYNTHETIC DICOM, FOR SMOKE-TESTING THE LIVE RENDER PATH.
 *
 * Owner directive 2026-09-10, "B and C"; this is B. `_shared/health/dicom.ts`
 * and `dicomRender.ts` are proven by 30 unit tests against fixtures built from
 * the standard — under vitest, in node. What NO test can reach is the parser
 * and the PNG encoder running inside DENO, against the real bucket, through
 * the deployed `documents.preview`. This file makes the bytes for that one
 * measurement.
 *
 * IT CONTAINS NO PERSON. A 64x64 16-bit gradient with a bright square, an
 * explicit-VR-little-endian header naming modality CR, body part CHEST and a
 * study date. There is no PatientName element and there is no patient: a real
 * DICOM carries a real person's name and has no business in a repository or in
 * a message to another agent.
 *
 *   node scripts/make-synthetic-dicom.mjs            -> size, sha256, base64
 *   node scripts/make-synthetic-dicom.mjs --out f.dcm
 *
 * WHAT IT DOES NOT PROVE, stated so nobody reads the smoke test as wider than
 * it is: this is a file written by the same understanding of the standard that
 * wrote the parser. It exercises the RUNTIME — Deno, storage, the deployed
 * function — and not the parser's agreement with a real scanner. That gate is
 * still a real X-ray from a real machine.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const ROWS = 64;
const COLS = 64;

/** One explicit-VR little-endian element. */
function el(group, element, vr, bytes) {
  const long = ["OB", "OW", "OF", "SQ", "UT", "UN"].includes(vr);
  const head = Buffer.alloc(long ? 12 : 8);
  head.writeUInt16LE(group, 0);
  head.writeUInt16LE(element, 2);
  head.write(vr, 4, "latin1");
  if (long) {
    head.writeUInt16LE(0, 6);
    head.writeUInt32LE(bytes.length, 8);
  } else {
    head.writeUInt16LE(bytes.length, 6);
  }
  return Buffer.concat([head, bytes]);
}

/** DICOM pads every value to an even length — NUL for binary, space for text. */
const txt = (s) => Buffer.from(s.length % 2 ? `${s} ` : s, "latin1");
const us = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
};

// A gradient with a bright block, so a wrong window or a missing rescale is
// visible rather than merely different: the block saturates and the ramp does
// not.
const pixels = Buffer.alloc(ROWS * COLS * 2);
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const inBlock = x >= 20 && x < 44 && y >= 20 && y < 44;
    const v = inBlock ? 3000 : Math.round((x / (COLS - 1)) * 1200);
    pixels.writeUInt16LE(v, (y * COLS + x) * 2);
  }
}

const dataset = Buffer.concat([
  el(0x0008, 0x0020, "DA", txt("20260901")), // StudyDate
  el(0x0008, 0x0060, "CS", txt("CR")), // Modality
  el(0x0008, 0x1030, "LO", txt("CHEST PA SYNTHETIC")), // StudyDescription
  el(0x0018, 0x0015, "CS", txt("CHEST")), // BodyPartExamined
  el(0x0028, 0x0002, "US", us(1)), // SamplesPerPixel
  el(0x0028, 0x0004, "CS", txt("MONOCHROME2")), // PhotometricInterpretation
  el(0x0028, 0x0010, "US", us(ROWS)), // Rows
  el(0x0028, 0x0011, "US", us(COLS)), // Columns
  el(0x0028, 0x0100, "US", us(16)), // BitsAllocated
  el(0x0028, 0x0101, "US", us(16)), // BitsStored
  el(0x0028, 0x0103, "US", us(0)), // PixelRepresentation (unsigned)
  el(0x0028, 0x1050, "DS", txt("1600")), // WindowCenter
  el(0x0028, 0x1051, "DS", txt("3200")), // WindowWidth
  el(0x7fe0, 0x0010, "OW", pixels), // PixelData
]);

// The meta group is ALWAYS explicit VR little endian, whatever the dataset
// uses; it is what names the dataset's transfer syntax.
const tsUid = "1.2.840.10008.1.2.1"; // Explicit VR Little Endian
const metaBody = Buffer.concat([
  el(0x0002, 0x0002, "UI", txt("1.2.840.10008.5.1.4.1.1.1")), // MediaStorageSOPClassUID (CR)
  el(0x0002, 0x0003, "UI", txt("1.2.826.0.1.3680043.8.498.99999999999999999999")),
  el(0x0002, 0x0010, "UI", txt(tsUid)),
]);
const meta = Buffer.concat([el(0x0002, 0x0000, "UL", (() => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(metaBody.length, 0);
  return b;
})()), metaBody]);

const file = Buffer.concat([
  Buffer.alloc(128), // the preamble: 128 unconstrained bytes, left zero here
  Buffer.from("DICM", "latin1"),
  meta,
  dataset,
]);

const outFlag = process.argv.indexOf("--out");
if (outFlag !== -1 && process.argv[outFlag + 1]) {
  writeFileSync(process.argv[outFlag + 1], file);
  console.error(`wrote ${process.argv[outFlag + 1]}`);
}
console.error(`size   ${file.length}`);
console.error(`sha256 ${createHash("sha256").update(file).digest("hex")}`);
console.error(`dims   ${COLS}x${ROWS}  16-bit MONOCHROME2  explicit VR LE`);
console.log(file.toString("base64"));
