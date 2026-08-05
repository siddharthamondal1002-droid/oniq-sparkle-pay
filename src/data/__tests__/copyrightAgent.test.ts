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
    // Measured from the LAST amendment where there is one, not from the
    // original filing. The three-year period restarts each time the
    // designation is submitted or amended, and the directory models an
    // amendment as a new dated version. Anchoring to the original date would
    // silently understate the deadline the moment anything is corrected.
    if (!DMCA_AGENT.registeredWithCopyrightOffice) return;
    const anchor = DMCA_AGENT.lastAmendedDate ?? DMCA_AGENT.registrationDate;
    const expected = new Date(`${anchor}T00:00:00Z`);
    expected.setUTCFullYear(expected.getUTCFullYear() + 3);
    expect(
      DMCA_AGENT.renewalDueDate,
      `renewal must be 3 years after ${DMCA_AGENT.lastAmendedDate ? "the last amendment" : "registration"} (${anchor})`,
    ).toBe(expected.toISOString().slice(0, 10));
  });

  it("never dates an amendment before the registration it amends", () => {
    if (!DMCA_AGENT.lastAmendedDate || !DMCA_AGENT.registrationDate) return;
    expect(
      DMCA_AGENT.lastAmendedDate >= DMCA_AGENT.registrationDate,
      `amended ${DMCA_AGENT.lastAmendedDate} but registered ${DMCA_AGENT.registrationDate}`,
    ).toBe(true);
  });

  it("publishes all four items §512(c)(2)(A) names, not just an email", () => {
    // The statute lists "the name, address, phone number, and electronic mail
    // address of the agent", and requires them on the website as well as on
    // the register. Publishing an email alone meets neither requirement, and
    // it is the natural thing to leave half-done — the register entry feels
    // like the finished task.
    if (!DMCA_AGENT.registeredWithCopyrightOffice) return;
    expect(DMCA_AGENT.agentName, "no agent name published").toBeTruthy();
    expect(DMCA_AGENT.agentAddress, "no agent postal address published").toBeTruthy();
    expect(DMCA_AGENT.agentPhone, "no agent phone published").toBeTruthy();
    expect(DMCA_AGENT.registrationNumber, "no registration number recorded").toMatch(/^DMCA-\d+$/);
    expect(DMCA_AGENT.agentEmail, "no registered agent mailbox published").toMatch(/@/);
    expect(page, "the page does not render the published agent block").toMatch(
      /DMCA_AGENT\.agentAddress/,
    );
    expect(page, "the register's own agent mailbox is not published").toMatch(
      /DMCA_AGENT\.agentEmail/,
    );
  });

  it("publishes both mailboxes while the register's is an alias of the role one", () => {
    // agentEmail is an alias of email with forwarding active — the same
    // mailbox by two names. Both are published: the register's address so the
    // two records agree, and the role address because it is the durable way
    // in. The page's claim that either reaches the agent is therefore a fact
    // about forwarding, not a hope.
    if (!DMCA_AGENT.registeredWithCopyrightOffice) return;
    if (DMCA_AGENT.agentEmail === DMCA_AGENT.email) return;
    expect(page).toMatch(/DMCA_AGENT\.agentEmail !== DMCA_AGENT\.email/);
    expect(page).toMatch(/reaches the designated agent/i);
  });

  it("keeps both mailboxes on the same domain, so the alias claim is plausible", () => {
    // A forwarding alias lives on the domain ONIQ controls. If agentEmail ever
    // moved to a domain ONIQ does not run, the forwarding guarantee — and the
    // page's "either address" claim — would stop being something this project
    // can vouch for.
    if (!DMCA_AGENT.agentEmail) return;
    const domain = (a: string) => a.split("@")[1];
    expect(
      domain(DMCA_AGENT.agentEmail),
      "the register's agent address left the domain ONIQ controls",
    ).toBe(domain(DMCA_AGENT.email));
  });

  it("gives the phone a country code that agrees with the agent's country", () => {
    // A notice sender is by definition somewhere else, so a bare national
    // number is unreachable. The nastier case is a national number written
    // with a leading "+": drop the 91 from an Indian mobile and +7980732371
    // is a syntactically perfect RUSSIAN number that someone will actually
    // dial. Shape alone cannot catch that — checking the shape was this
    // test's first version, and it passed the broken number happily. The
    // dialling code has to be checked against the address.
    if (!DMCA_AGENT.agentPhone) return;
    expect(DMCA_AGENT.agentPhone, "not E.164 — needs a leading + and country code").toMatch(
      /^\+[1-9]\d{7,14}$/,
    );
    if (DMCA_AGENT.agentAddress && /\bindia\b/i.test(DMCA_AGENT.agentAddress)) {
      expect(
        DMCA_AGENT.agentPhone,
        `agent is in India but ${DMCA_AGENT.agentPhone} is not a +91 number`,
      ).toMatch(/^\+91\d{10}$/);
    }
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
