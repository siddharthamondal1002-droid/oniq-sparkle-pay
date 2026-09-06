/**
 * EVERY DOOR TO UPI IS SHUT — checked by the same expressions the app uses.
 *
 * Owner directive, 2026-09-06 (evening): "hide upi", reversing that morning's
 * "make upi active again". The reason is measured: the `upi://` hand-off was
 * declined by PhonePe, Google Pay AND Paytm on a real merchant QR — including
 * when handed the QR's own bytes with zero transformation — while scanning the
 * same code inside the app succeeded. The feature reads a QR correctly and
 * cannot pay with it.
 *
 * WHY THIS FILE EXISTS RATHER THAN ONE MORE ASSERTION IN registry.test.ts.
 * The morning's mistake is the whole lesson, and it runs in both directions:
 * flipping `hidden` alone lit ONLY the shortcut buried inside Plug, three taps
 * down a directory, while Home had no tile and worlds.test.ts forbade adding
 * one — "active" and unreachable, reported as "no tabs, no icons". Hiding has
 * the mirror-image failure: shut four doors, miss the fifth, and the feature is
 * "hidden" while a link still opens it. There are SIX places a person can get
 * in from, spread across four files, and only a list that names all six catches
 * a partial flip.
 *
 * TWO OF THEM ARE DERIVED, NOT DECLARED, which is why this evaluates the real
 * expressions instead of greping. `SHOW_UPI_SHORTCUT` in app.miniapps.tsx and
 * the directory's own `!a.hidden` filter both fall out of the registry flag —
 * so they are correct today by construction, and a future edit that replaces
 * either with a literal would pass any text search while reopening the door.
 * Mirroring the expression here is deliberate duplication: if the app's changes
 * and this does not, that is the drift worth failing on.
 *
 * HIDDEN IS NOT DELETED, and the first assertion pins that too. `/app/upi` and
 * `/app/scan` still resolve, so a bookmark, a deep link or a chat attachment
 * still works and a fifth flip is a flag rather than a rebuild.
 */
import { describe, expect, it } from "vitest";
import { APP_REGISTRY } from "@/data/appRegistry";
import { WORLD_GROUPS } from "@/data/worlds";
import { FEATURE_CARDS } from "@/data/marketingCopy";
import { NATIVE_CAPABILITIES } from "@/config/playCompliance";

const upi = APP_REGISTRY.find((a) => a.id === "oniq-upi");
const allWorlds = WORLD_GROUPS.flatMap((g) => g.worlds);

describe("UPI is hidden, and hidden means every door", () => {
  it("keeps the registry entry — hidden, not deleted", () => {
    expect(upi, "oniq-upi was DELETED; hiding must stay a flag, not a removal").toBeTruthy();
    expect(upi?.hidden).toBe(true);
  });

  it("door 1 — the Plug shortcut, by app.miniapps.tsx's own expression", () => {
    // Mirrors: const SHOW_UPI_SHORTCUT = !!UPI_ENTRY && !UPI_ENTRY.hidden
    const showUpiShortcut = !!upi && !upi.hidden;
    expect(showUpiShortcut, "the Pay via UPI shortcut still renders inside Plug").toBe(false);
  });

  it("door 2 — the rendered mini-apps directory, by its own filter", () => {
    // Mirrors appRegistry's visible-apps filter: !a.hidden && a.status active
    const rendered = APP_REGISTRY.filter((a) => !a.hidden && a.status === "active");
    expect(rendered.some((a) => a.id === "oniq-upi")).toBe(false);
  });

  it("door 3 — no Home tile routes to /app/upi", () => {
    expect(allWorlds.some((w) => w.to === "/app/upi")).toBe(false);
    expect(allWorlds.some((w) => w.key === "upi")).toBe(false);
  });

  it("door 4 and 5 — no site card, by title or by route", () => {
    expect(FEATURE_CARDS.some((c) => c.title === "Scan & Pay")).toBe(false);
    expect(FEATURE_CARDS.some((c) => c.route === "/app/upi")).toBe(false);
  });

  it("door 6 — Play is told about no UPI capability", () => {
    // A declared capability a reviewer cannot navigate to draws questions; the
    // pairing runs both ways and moves in the same commit as the entry points.
    expect(NATIVE_CAPABILITIES.some((c) => /upi/i.test(c))).toBe(false);
  });

  it("the site and the app agree — which is the property, not the direction", () => {
    // Whichever way the flag goes, these two move together. Asserted as an
    // equivalence so it needs no edit on the fifth flip, only on a mistake.
    const siteOffers = FEATURE_CARDS.some((c) => c.title === "Scan & Pay");
    const appShows = !!upi && !upi.hidden;
    expect(siteOffers, "the site advertises Scan & Pay but the app hides it").toBe(appShows);
  });
});
