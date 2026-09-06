/**
 * Which QR decoder Scan & Pay uses, and why it is worth being able to see.
 *
 * `BarcodeDetector` IS Google's barcode API: Chromium implements the Shape
 * Detection API on top of Play Services' ML Kit scanner on Android, so the fast
 * path in decodeQr.ts already runs Google's detector on the platform ONIQ ships
 * to. jsQR is the fallback for engines exposing no detector.
 *
 * THE FAILURE THIS GUARDS IS A SILENT ONE. A fallback to jsQR looks identical
 * from the outside to a Google-backed scan that simply missed the code — the
 * user just sees a scanner that feels bad on a shop counter. `activeQrDecoder`
 * turns that into something readable on /app/diag from a real handset, which
 * matters because the Capacitor WebView demonstrably does NOT expose everything
 * mobile Chrome does: on 2026-09-06 it blocked reCAPTCHA outright.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { activeQrDecoder } from "../qr/decodeQr";

// getDetector() bails on `typeof window === "undefined"` before it looks for a
// detector, so a bare globalThis assignment tests nothing — the first draft of
// this file reported "jsqr" for every case and looked like it passed.
const g = globalThis as unknown as { window?: unknown };
const hadWindow = "window" in g;

const withDetector = (Detector: unknown) => {
  g.window = { BarcodeDetector: Detector };
};

afterEach(() => {
  if (hadWindow) return;
  delete g.window;
});

describe("activeQrDecoder", () => {
  it("reports jsqr when the engine exposes no detector", () => {
    g.window = {};
    expect(activeQrDecoder()).toBe("jsqr");
  });

  it("reports barcode-detector when one is constructible", () => {
    withDetector(
      class {
        constructor(_: unknown) {}
      },
    );
    expect(activeQrDecoder()).toBe("barcode-detector");
  });

  it("reports jsqr when the constructor exists but THROWS", () => {
    // The real reason getDetector() has a try/catch: a browser can expose the
    // symbol and still refuse `{ formats: ["qr_code"] }`. Reporting
    // "barcode-detector" there would be a diagnostic that lies in exactly the
    // situation someone is reading it to understand.
    withDetector(
      class {
        constructor(_: unknown) {
          throw new Error("qr_code not supported");
        }
      },
    );
    expect(activeQrDecoder()).toBe("jsqr");
  });

  it("is a pure feature check — never reads the user agent", () => {
    // Same rule the rest of decodeQr.ts follows, and the reason it holds up in
    // a WebView whose UA string resembles Chrome's while its capabilities differ.
    const text = readFileSync(new URL("../qr/decodeQr.ts", import.meta.url), "utf8");
    expect(text).not.toMatch(/navigator\.userAgent/);
  });
});
