/**
 * THE UPI PATH, PROVEN — the half that can be proven without a handset.
 *
 * Owner, 2026-09-06: _"just upi path was not proven successful again same
 * problem"_. Correct, and the same shape as MSG91: every piece of this feature
 * was written, reviewed and shipped, and not one line of it had ever been
 * observed to survive a round trip. Parse was unit-tested against strings
 * somebody typed; the QR ONIQ actually PRINTS had never once been decoded back.
 *
 * That is the gap this file closes, and the distinction matters. A test that
 * asserts `upiLink()` returns the string you expect proves the formatter. It
 * says nothing about whether the PNG on the Receive tab, rendered by `qrcode`
 * at the app's own settings, can be read by a scanner at all — which is the
 * only thing standing between a user and being paid. Between those two facts
 * sit the encoder's error-correction level, its quiet-zone margin, the module
 * size at 560px, and the payload length once a long display name is in it. Any
 * of those can produce a beautiful, unreadable square.
 *
 * SO THIS DECODES THE REAL IMAGE. `QRCode.toDataURL` with the EXACT options
 * `ReceiveTab` passes, the PNG unpacked to RGBA, and jsQR — the same decoder
 * `decodeQr.ts` falls back to on any engine without BarcodeDetector — reading
 * it back. If the printed QR is unreadable, this goes red.
 *
 * WHAT IT STILL CANNOT PROVE, stated so nobody reads a green run as more than
 * it is: whether Android hands `upi://pay?…` to GPay or PhonePe, and whether a
 * real bank moves real money. Both need a handset and a live UPI app. This
 * proves the bytes are right the whole way to the OS boundary — which is
 * exactly where ONIQ's responsibility ends under the facilitator model.
 */
import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { decode as decodePng } from "fast-png";
import { upiLink, upiPayeeLink, isValidVpa } from "@/lib/miniapps";
import { parseUpiUri } from "@/routes/_authenticated/app.scan";

/** Decode a `data:image/png;base64,…` QR the way a scanner would. */
function decodeQrPng(dataUrl: string): string | null {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const png = decodePng(Buffer.from(b64, "base64"));
  // fast-png hands back the channels the file actually has; jsQR wants RGBA.
  const rgba = toRgba(png.data, png.width, png.height, png.channels);
  const res = jsQR(rgba, png.width, png.height);
  return res?.data ?? null;
}

/** Widen 1/2/3-channel pixel data to the RGBA jsQR requires. */
function toRgba(
  data: ArrayLike<number>,
  w: number,
  h: number,
  channels: number,
): Uint8ClampedArray {
  if (channels === 4) return new Uint8ClampedArray(Array.from(data));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * channels;
    const [r, g, b] =
      channels >= 3 ? [data[s], data[s + 1], data[s + 2]] : [data[s], data[s], data[s]];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = channels === 2 ? data[s + 1] : 255;
  }
  return out;
}

/** The exact options ReceiveTab renders with — drift here is a real bug. */
const RECEIVE_QR_OPTS = {
  width: 560,
  margin: 2,
  color: { dark: "#0E0F13", light: "#FFFFFF" },
} as const;

describe("the QR ONIQ prints can actually be scanned", () => {
  it("round-trips a plain receive QR through a real decoder", async () => {
    const link = upiLink({ vpa: "siddhartha@okhdfcbank", name: "Siddhartha" });
    const png = await QRCode.toDataURL(link, RECEIVE_QR_OPTS);
    expect(decodeQrPng(png)).toBe(link);
  });

  it("round-trips with an amount, which is the common case", async () => {
    const link = upiLink({ vpa: "siddhartha@okhdfcbank", name: "Siddhartha", amount: 249.5 });
    const png = await QRCode.toDataURL(link, RECEIVE_QR_OPTS);
    const decoded = decodeQrPng(png);
    expect(decoded).toBe(link);
    // and the amount survives as UPI wants it — two decimals, not "249.5"
    expect(decoded).toContain("am=249.50");
  });

  it("stays readable with a long display name, which is where density bites", async () => {
    // The payload grows with the name; a 560px QR has a finite module budget.
    // This is the case that fails silently in production and nowhere else.
    const link = upiLink({
      vpa: "verylongbusinessname.payments@okaxisbank",
      name: "Siddhartha Mondal Enterprises Private Limited",
      amount: 99999,
      note: "Invoice 2026-09-06 settlement for September",
    });
    const png = await QRCode.toDataURL(link, RECEIVE_QR_OPTS);
    expect(decodeQrPng(png)).toBe(link);
  });

  it("the decoded QR parses back into the same payee — closing the loop", async () => {
    const vpa = "siddhartha@okhdfcbank";
    const link = upiLink({ vpa, name: "Siddhartha", amount: 100 });
    const decoded = decodeQrPng(await QRCode.toDataURL(link, RECEIVE_QR_OPTS));
    const parsed = parseUpiUri(decoded!);
    expect(parsed).not.toBeNull();
    expect(parsed!.pa).toBe(vpa);
    expect(parsed!.am).toBe("100.00");
  });
});

describe("a merchant QR reaches the UPI app unchanged", () => {
  // Merchant/Bharat QRs carry fields ONIQ does not model. Rebuilding the URI
  // from parsed parts drops mc/tr/mode/sign, and a UPI app then treats a
  // merchant payment as unverified P2P and declines it. The scanned bytes must
  // survive to the launch untouched.
  const MERCHANT =
    "upi://pay?pa=store@ybl&pn=Kirana%20Store&am=1200.00&cu=INR&tn=Order%20882" +
    "&mc=5411&tr=TXN1234567890&tid=TID998877&mode=02&orgid=159753&sign=MEUCIQDabc123";

  it("survives a scan as an image, byte for byte", async () => {
    // Render it as a shop would print it, then read it as the phone would.
    const png = await QRCode.toDataURL(MERCHANT, { width: 560, margin: 2 });
    const decoded = decodeQrPng(png);
    expect(decoded).toBe(MERCHANT);

    const parsed = parseUpiUri(decoded!);
    expect(parsed!.raw).toBe(MERCHANT);
  });

  it("keeps every unmodelled field the parser never looks at", () => {
    const parsed = parseUpiUri(MERCHANT)!;
    for (const field of ["mc=5411", "tr=TXN1234567890", "tid=TID998877", "mode=02", "orgid=159753", "sign=MEUCIQDabc123"]) {
      expect(parsed.raw).toContain(field);
    }
  });

  it("REBUILDING the URI would drop them — the failure this guards against", () => {
    const parsed = parseUpiUri(MERCHANT)!;
    // What the app would send if `rawIntact` were ever dropped:
    const rebuilt = upiLink({ vpa: parsed.pa, name: parsed.pn!, amount: Number(parsed.am) });
    expect(rebuilt).not.toContain("sign=");
    expect(rebuilt).not.toContain("mc=");
    expect(rebuilt).not.toBe(MERCHANT);
    // Which is precisely why app.upi.tsx launches `prefill.raw` when untouched.
  });
});

describe("what the payer's UPI app is actually handed", () => {
  // Mirrors the `rawIntact` decision in app.upi.tsx confirmPay(): an untouched
  // scan launches the original bytes; anything the user edited goes payee-only,
  // because PhonePe & co decline third-party intents that pre-fill an amount.
  function launchPayload(
    prefill: { pa?: string; am?: string; tn?: string; raw?: string },
    edited: { vpa: string; amount: string; note: string },
  ) {
    const rawIntact =
      !!prefill.raw &&
      edited.vpa.trim() === (prefill.pa ?? "") &&
      edited.amount.trim() === (prefill.am ?? "") &&
      edited.note.trim() === (prefill.tn ?? "");
    return rawIntact
      ? prefill.raw!
      : upiPayeeLink({ vpa: edited.vpa.trim(), name: edited.vpa.trim() });
  }

  const scan = parseUpiUri(
    "upi://pay?pa=store@ybl&pn=Kirana&am=1200.00&mc=5411&tr=TXN1&sign=abc",
  )!;

  it("an untouched scan launches the merchant's own bytes", () => {
    const out = launchPayload(scan, { vpa: scan.pa, amount: scan.am!, note: "" });
    expect(out).toBe(scan.raw);
    expect(out).toContain("sign=abc");
  });

  it("editing the amount drops to payee-only, with no am= at all", () => {
    const out = launchPayload(scan, { vpa: scan.pa, amount: "50", note: "" });
    expect(out).not.toContain("sign=");
    expect(out).not.toContain("am=");
    expect(out).toContain("pa=store%40ybl");
  });

  it("a hand-typed send never carries an amount", () => {
    const out = launchPayload({}, { vpa: "friend@okicici", amount: "500", note: "lunch" });
    expect(out).not.toContain("am=");
    expect(out.startsWith("upi://pay?")).toBe(true);
  });

  it("every payload it can emit is a valid upi:// intent with a valid payee", () => {
    for (const out of [
      launchPayload(scan, { vpa: scan.pa, amount: scan.am!, note: "" }),
      launchPayload(scan, { vpa: scan.pa, amount: "50", note: "" }),
      launchPayload({}, { vpa: "friend@okicici", amount: "500", note: "x" }),
    ]) {
      expect(out).toMatch(/^upi:\/\/pay\?/);
      const pa = new URLSearchParams(out.slice(out.indexOf("?") + 1)).get("pa")!;
      expect(isValidVpa(pa)).toBe(true);
    }
  });
});
