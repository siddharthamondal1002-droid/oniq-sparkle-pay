/**
 * The §512 designation, as a test.
 *
 * WHY THIS EXISTS NOW
 *
 * The Copyright Office registration is in progress: a Login.gov account is
 * connected to the DMCA Designated Agent Directory, but no designation has
 * been filed. The moment it is, somebody flips
 * `registeredWithCopyrightOffice` to true — and that single boolean changes
 * what a public legal page asserts about ONIQ's liability position.
 *
 * Two failure modes are worth pinning before that happens.
 *
 *   1. The flag flips and the dates do not. /dmca renders
 *      "Registered null; renewal due null" on a page whose entire purpose is
 *      to be precise about a statutory claim.
 *
 *   2. The renewal date is wrong or absent. A §512 designation lapses after
 *      three years, and an expired designation does not degrade gracefully —
 *      it voids the harbour. There is no warning from the Office.
 *
 * The flag is allowed to be false. What is not allowed is a claim of
 * registration that is not fully specified.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DMCA_AGENT, DMCA_PROTECTION } from "@/config/copyright";

const ROOT = process.cwd();
const page = readFileSync(join(ROOT, "src/routes/dmca.tsx"), "utf8");

const ISO = /^\d{4}-\d{2}-\d{2}$/;

describe("a claim of registration must be fully specified", () => {
  it("carries both dates if and only if it claims to be registered", () => {
    if (DMCA_AGENT.registeredWithCopyrightOffice) {
      expect(DMCA_AGENT.registrationDate, "registered with no registration date").toMatch(ISO);
      expect(DMCA_AGENT.renewalDueDate, "registered with no renewal date").toMatch(ISO);
    } else {
      // Dates without a registration would be just as misleading in reverse.
      expect(DMCA_AGENT.registrationDate).toBeNull();
      expect(DMCA_AGENT.renewalDueDate).toBeNull();
    }
  });

  it("sets renewal three years out, because a lapse voids the harbour", () => {
    if (!DMCA_AGENT.registeredWithCopyrightOffice) return;
    const from = new Date(`${DMCA_AGENT.registrationDate}T00:00:00Z`);
    const due = new Date(`${DMCA_AGENT.renewalDueDate}T00:00:00Z`);
    const expected = new Date(from);
    expected.setUTCFullYear(expected.getUTCFullYear() + 3);
    expect(
      due.toISOString().slice(0, 10),
      "§512 designations lapse after 3 years — the renewal date must match",
    ).toBe(expected.toISOString().slice(0, 10));
  });

  it("points at the Copyright Office register, not a vendor", () => {
    expect(DMCA_AGENT.directoryUrl).toMatch(/^https:\/\/dmca\.copyright\.gov\//);
    expect(DMCA_AGENT.email).toMatch(/@oniqhub\.com$/);
  });
});

describe("the vendor badge is never allowed to read as a designation", () => {
  it("keeps the two facts in separate constants", () => {
    // Conflating them is the exact mistake the badge invites, so the shapes
    // are deliberately different: one is a designation, one is a subscription.
    expect(Object.keys(DMCA_AGENT)).not.toContain("vendorProtection");
    expect(Object.keys(DMCA_PROTECTION)).not.toContain("registeredWithCopyrightOffice");
  });

  it("the page says plainly what the badge is not, while the badge is shown", () => {
    if (!DMCA_PROTECTION.vendorProtection) return;
    expect(page).toMatch(/badges of this kind are widely misread/i);
    expect(page, "the page must not let the badge stand in for §512").toMatch(/512/);
  });

  it("does not claim the harbour while unregistered", () => {
    if (DMCA_AGENT.registeredWithCopyrightOffice) return;
    expect(page).toMatch(/not yet/i);
    expect(page).toMatch(/does not claim the §512 safe harbour/i);
  });
});
