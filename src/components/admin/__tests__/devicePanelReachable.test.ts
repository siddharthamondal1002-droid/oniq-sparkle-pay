/**
 * THE DEVICE READINGS MUST BE REACHABLE BY TAPPING.
 *
 * `/app/diag` carries the same two facts and is reached only by TYPING its
 * URL. Inside the Capacitor WebView there is no address bar, so on the one
 * device whose answer matters the screen is unreachable — which is how a
 * shipped, verified, correctly-serving diagnostic produced "no tabs, no icons"
 * instead of a reading.
 *
 * A LINK IS NOT THE FIX, and that is measured rather than assumed: the comment
 * beside the Runway anchor in `app.admin.tsx` records that on the owner's
 * device both a router `Link` and a plain anchor to a separate admin route did
 * NOTHING (2026-08-26), while the section chips work. So the property worth
 * pinning is not "a link exists" — it is that the readings render INLINE in a
 * section of an already-reachable screen.
 *
 * These are source assertions rather than a render test on purpose. What can
 * regress here is the WIRING — a chip removed, a panel that stops being
 * rendered, or the mount gate deleted — and every one of those leaves a
 * component that still renders perfectly on its own in a test harness.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../../..");
const admin = readFileSync(join(ROOT, "src/routes/_authenticated/app.admin.tsx"), "utf8");
const panel = readFileSync(join(ROOT, "src/components/admin/DevicePanel.tsx"), "utf8");

describe("the device readings are reachable without typing a URL", () => {
  it("the admin screen renders DevicePanel inline", () => {
    expect(admin).toMatch(/import \{ DevicePanel \} from "@\/components\/admin\/DevicePanel"/);
    expect(admin).toMatch(/section === "device" && <DevicePanel \/>/);
  });

  it("a 'device' chip exists in the section list, so the panel can be selected", () => {
    expect(admin).toMatch(/\["device", "device [^"]*"\]/);
  });

  it('"device" is a member of the section union, or the chip cannot be selected', () => {
    // Widening the chip list without widening the union is a typecheck failure,
    // but the union could equally be widened while the chip is dropped — then
    // the section exists and nothing can reach it, which is this file's whole
    // subject.
    expect(admin).toMatch(/\|\s*"device"/);
  });

  it("the admin screen itself is reachable by tapping, from Profile", () => {
    const profile = readFileSync(join(ROOT, "src/routes/_authenticated/app.profile.tsx"), "utf8");
    expect(profile).toMatch(/to="\/app\/admin"/);
  });
});

describe("the reading is the browser's, not the server's", () => {
  it("gates the probes behind a mounted flag", () => {
    // activeQrDecoder() returns "jsqr" whenever `window` is undefined — exactly
    // what SSR sees. Printing that unguarded would show a confident "jsqr" on a
    // device that exposes BarcodeDetector: a wrong answer wearing the clothes
    // of a measurement.
    expect(panel).toMatch(/useEffect\(\(\) => \{\s*setMounted\(true\);?\s*\},\s*\[\]\)/);
    expect(panel).toMatch(/mounted \? activeQrDecoder\(\) : null/);
    expect(panel).toMatch(/mounted \? cameraSupported\(\) : null/);
  });

  it("never hardcodes a decoder verdict — it reports what the probe returns", () => {
    // The failure this catches is a panel that says "barcode-detector" as text
    // rather than as the value of the call.
    const withoutHints = panel.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutHints).toMatch(/value=\{decoder \?\? "reading…"\}/);
  });

  it("says out loud that a mobile browser can answer differently", () => {
    // The WebView blocked reCAPTCHA on 2026-09-06 while every browser allowed
    // it, so a reading taken in Chrome answers a question nobody asked.
    expect(panel).toMatch(/mobile browser can answer differently/i);
  });
});
