/**
 * THE DECLINE HELP MUST SHOW UP IN THE CASE THAT ACTUALLY FAILS.
 *
 * Measured 2026-09-06 on the owner's handset, through ONIQ, on a society's SBI
 * merchant collection QR:
 *
 *     ONIQ -> the raw scanned bytes, ZERO transformation -> PhonePe -> DECLINED
 *     ONIQ -> the ordinary Pay button                    -> PhonePe -> DECLINED
 *     the same QR scanned inside PhonePe itself          -> SUCCEEDED
 *
 * The first line is what makes it conclusive. That intent is the QR's own
 * bytes, so no string ONIQ could have built would have changed it: PhonePe
 * opened, showed the payment, and refused the HAND-OFF.
 *
 * TWO THINGS ARE PINNED HERE, AND BOTH ARE THINGS A TYPECHECK CANNOT SEE.
 *
 * FIRST, THE WARNING IS NOT GATED ON `!rawIntact`. It used to be — which hid
 * it in precisely the untouched-scan case that is the one measured to fail.
 * A guard that suppresses the advice exactly where the advice is needed reads
 * as working code and is worse than none.
 *
 * SECOND, THE FALSE REASSURANCE STAYS DELETED. The panel used to end "Shop QRs
 * scanned with ONIQ and your own receive QR are unaffected — this only hits
 * person-to-person sends handed to another app." A shop QR is exactly what was
 * declined. Telling someone the panel does not apply to them, on the screen
 * where it does, sends them away from the one route that works. The same claim
 * was carried in `miniapps.ts` and `appRegistry.ts`; those are pinned too,
 * because a comment that contradicts the UI is how the UI gets "corrected"
 * back to the wrong thing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Comments are stripped before the "no longer claims this" assertions, and
 * that is not a convenience — it is the difference between the two things
 * being tested.
 *
 * The corrections deliberately QUOTE the sentence they overturn, so that the
 * next reader sees what was believed and why it was wrong. A naive grep for
 * the old wording therefore fires on the very comment that fixes it, and the
 * only ways to make it pass are to delete the history or to weaken the test.
 * Stripping comments lets the record stay and still asserts what matters:
 * that no live string or expression says it any more.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const SCREEN = read("src/routes/_authenticated/app.upi.tsx");
const MINIAPPS = read("src/lib/miniapps.ts");
const REGISTRY = read("src/data/appRegistry.ts");

describe("the decline help reaches the case that fails", () => {
  it("still renders the help panel after a launch", () => {
    expect(SCREEN).toContain('data-testid="upi-declined-help"');
    expect(SCREEN).toContain("{launched && (");
  });

  it("names the route that was measured to work", () => {
    // The panel must lead with "use your UPI app's own scanner", because that
    // is the step the owner actually completed the payment with.
    expect(SCREEN).toMatch(/Point your UPI app at the QR/i);
    expect(SCREEN).toContain("Copy UPI ID");
  });

  /**
   * The gate is the regression. `!rawIntact &&` in front of the confirm-sheet
   * bullet is what hid the warning on an untouched scan, so its ABSENCE is the
   * property worth asserting — not the presence of some wording, which anyone
   * could satisfy while re-adding the gate.
   */
  it("the confirm-sheet warning is not suppressed on an untouched scan", () => {
    const sheet = SCREEN.slice(SCREEN.indexOf('data-testid="upi-confirm-sheet"'));
    const bullets = sheet.slice(0, sheet.indexOf("</ul>"));
    expect(bullets).toMatch(/if it declines/i);

    // Find the <li> the decline text lives in, then look at what immediately
    // precedes that tag. A JSX conditional wrapping it ends in "&& (" — that
    // is the exact shape of the bug, so it is the thing asserted against.
    // The amount hint above may legitimately stay gated; this line may not.
    const at = bullets.search(/if it declines/i);
    const liStart = bullets.lastIndexOf("<li>", at);
    expect(liStart).toBeGreaterThan(-1);
    const before = stripComments(bullets.slice(0, liStart)).trimEnd();
    expect(before.endsWith("&& (")).toBe(false);
    expect(before.endsWith("&&")).toBe(false);
    expect(before.endsWith("?")).toBe(false);
  });
});

describe("the disproven claim stays disproven", () => {
  it.each([
    ["the pay screen", SCREEN],
    ["miniapps.ts", MINIAPPS],
    ["appRegistry.ts", REGISTRY],
  ])("%s no longer asserts merchant/shop QRs are unaffected", (_label, src) => {
    const live = stripComments(src);
    expect(live).not.toMatch(/[Ss]hop QRs scanned with ONIQ/);
    expect(live).not.toMatch(/[Mm]erchant intents are unaffected/);
    expect(live).not.toMatch(/[Ss]canning a merchant QR is\s+unaffected/);
  });

  it("the stripper actually removes comments, or the check above is vacuous", () => {
    // A test whose subject can be neutralised by its own helper has to prove
    // the helper works — otherwise a broken stripper returns "" and every
    // not.toMatch above passes for the wrong reason.
    expect(stripComments("a /* x */ b")).not.toContain("x");
    expect(stripComments("a // x\nb")).not.toContain("x");
    expect(stripComments("a /* x */ b")).toContain("a");
    expect(stripComments("a // x\nb")).toContain("b");
    expect(stripComments(SCREEN)).toContain("upi-declined-help");
    expect(stripComments(REGISTRY).length).toBeGreaterThan(1000);
  });

  it("receiving is still called out as unaffected, because it is", () => {
    // Receiving needs no hand-off at all, so the one true half of the old
    // sentence is kept rather than thrown out with the false half.
    expect(SCREEN).toMatch(/Your own receive QR is unaffected/);
  });

  it("miniapps records the measured run rather than a theory", () => {
    expect(MINIAPPS).toContain("ZERO transformation");
    expect(MINIAPPS).toMatch(/SUCCEEDED/);
    // all three apps, since that is what was measured in the end
    expect(MINIAPPS).toMatch(/Google Pay -> DECLINED/);
    expect(MINIAPPS).toMatch(/Paytm -> DECLINED/);
    // and is still honest about how far it generalises
    expect(MINIAPPS).toMatch(/ONE handset, ONE merchant QR/);
  });
});

/**
 * THE STOREFRONT MUST NOT PROMISE AN OUTCOME ONIQ DOES NOT CONTROL.
 *
 * Owner directive 2026-09-06, after testing all three: "all failed" — a
 * merchant QR handed over by ONIQ was declined by PhonePe, Google Pay AND
 * Paytm, while scanning the same code inside the app succeeded. The site card
 * and the Home tile both said "pay from your own GPay, PhonePe or Paytm",
 * which asserts a completed payment. They now say "open it in", which is the
 * part ONIQ actually performs.
 *
 * Pinned against the wording rather than the sentiment, because "pay from" is
 * the exact phrase that was false and it is the one an editor reaches for when
 * tightening a card. The card TITLE and its live/hidden agreement with
 * appRegistry are pinned separately in marketingCopy.test.ts and are untouched
 * by this.
 */
describe("the storefront claims only what ONIQ does", () => {
  const CARD = stripComments(read("src/data/marketingCopy.ts"));
  const TILE = stripComments(read("src/data/worlds.ts"));
  const PLAY = stripComments(read("src/config/playCompliance.ts"));

  it("no surface says 'pay from your own'", () => {
    for (const src of [CARD, TILE, PLAY]) {
      expect(src).not.toMatch(/pay from your own/i);
    }
  });

  /**
   * THE SOFTENED WORDING OUTLIVED ITS OWN SURFACES BY ABOUT AN HOUR.
   *
   * "open it in your own GPay, PhonePe or Paytm" was the corrected site card;
   * the owner then said "hide upi" and the card, the Home tile and the Play
   * capability line all went away. So there is no longer anything to soften,
   * and the assertion becomes the stronger one: ONIQ makes NO UPI claim at all.
   *
   * The `pay from` check above still earns its place — it is what an editor
   * would reach for if any of these came back — but it is now checking that a
   * phrase stays absent from files that mention UPI nowhere, which is a weaker
   * guarantee than it looks. This is the assertion that actually holds the
   * line, so it is stated positively rather than as three absences.
   */
  it("makes no UPI claim on any storefront surface", () => {
    for (const [label, src] of [
      ["the site card deck", CARD],
      ["the Home tile list", TILE],
      ["the Play declaration", PLAY],
    ] as const) {
      expect(src, `${label} still advertises UPI`).not.toMatch(/UPI QR/i);
      expect(src, `${label} still advertises UPI`).not.toMatch(/scan-and-pay/i);
    }
  });
});
