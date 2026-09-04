/**
 * "ACCESS REQUIRED", NOT "UNAVAILABLE" — and a screen that actually says it.
 *
 * OWNER DIRECTIVE, 2026-09-04c, given after voice cloning was written off:
 *
 *   "Do NOT label voice cloning simply as 'UNAVAILABLE'. Use:
 *    voice.clone -> GOOGLE -> Gated / Allowlisted"
 *
 * The distinction is the whole point. "We cannot do that" and "Google does
 * this, and this account is not admitted yet" are different facts. A person
 * told the first stops asking; a person told the second knows there is a door.
 * The registry existed for a day with no consumer, which meant the sentence
 * the owner asked for was written down and shown to nobody — so these tests
 * assert BOTH the data and the fact that a screen renders it.
 *
 * They also hold the line that makes the file worth having: a state with no
 * evidence is an opinion, and this file is the cure for opinions hardening
 * into architecture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  isLive,
  unavailableMessage,
  type CapabilityId,
} from "../../data/capabilities";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const IDS = Object.keys(CAPABILITIES) as CapabilityId[];

describe("every entry is well formed", () => {
  it("keys itself, so a copy-paste cannot mislabel a row", () => {
    for (const id of IDS) expect(CAPABILITIES[id].id).toBe(id);
  });

  it("carries dated, quoted evidence rather than a summary", () => {
    for (const id of IDS) {
      const e = CAPABILITIES[id].evidence;
      // Long enough to be a measurement, and naming either a date or the
      // endpoint's own words. A one-line assertion is an opinion.
      expect(e.length, id).toBeGreaterThan(60);
      expect(e, id).toMatch(/2026-09-04|gemini|lyria|aiplatform|generateContent|bidi/i);
    }
  });

  it("gives every non-LIVE capability something to tell a person", () => {
    for (const id of IDS) {
      if (CAPABILITIES[id].state === "LIVE") continue;
      expect(unavailableMessage(id), id).toBeTruthy();
    }
  });

  it("never says 'unavailable' for something that is merely gated", () => {
    for (const id of IDS) {
      if (CAPABILITIES[id].state !== "GATED") continue;
      expect(unavailableMessage(id)?.toLowerCase(), id).not.toContain("unavailable");
    }
  });

  it("names one provider and never leaks it into what a person reads", () => {
    // The UI must not name a provider; the evidence must, because that is
    // what makes it checkable.
    for (const id of IDS) {
      expect(CAPABILITIES[id].provider).toBe("google");
      const msg = CAPABILITIES[id].userMessage;
      if (!msg || id === "voice.clone") continue;
      // voice.clone is the one exception: the owner asked for that exact
      // string, and it names the product rather than the vendor's API.
      expect(msg.toLowerCase(), id).not.toMatch(/gemini|lyria|vertex|googleapis/);
    }
  });
});

describe("voice.clone — the entry the directive was given about", () => {
  const clone = CAPABILITIES["voice.clone"];

  it("is GATED, not CLOSED", () => {
    // CLOSED would mean the provider does not expose it. It does; the flow is
    // built and unit-tested in _shared/voiceReplication.ts.
    expect(clone.state).toBe("GATED");
    expect(isLive("voice.clone")).toBe(false);
  });

  it("uses the owner's exact wording", () => {
    expect(clone.userMessage).toBe("Google Voice Replication — Access required");
  });

  it("records the correction, so the wrong conclusion is not redrawn", () => {
    // The first probes ran against the wrong host entirely and concluded "no
    // such surface". Deleting that would invite the same mistake.
    expect(clone.evidence).toMatch(/VERTEX AI/);
    expect(clone.evidence).toMatch(/wrong, and is corrected here/i);
  });

  it("records what is measured about the credential, not what is assumed", () => {
    // Three attempts, one answer, fired BEFORE any project check — so it is a
    // credential-type problem and no arrangement of the API key can fix it.
    expect(clone.evidence).toMatch(/API keys are not supported by this API/);
    expect(clone.evidence).toMatch(/BEFORE any project or allowlist check/i);
  });

  it("says whose money the remaining decision spends", () => {
    // FIREBASE_SERVICE_ACCOUNT would work and is not used on sight: pointing
    // Vertex at that project bills that project. CLAUDE.md's first rule.
    expect(clone.evidence).toMatch(/GOOGLE_VERTEX_USE_FIREBASE_SA/);
    expect(clone.evidence).toMatch(/billing account/i);
  });
});

describe("the sentence reaches a person", () => {
  const VOICE = read("src/routes/_authenticated/app.voice.tsx");

  it("is rendered from the registry, not retyped into the screen", () => {
    // A retyped string drifts the day the registry changes, and then the
    // screen is confidently telling somebody something that is no longer so.
    expect(VOICE).toContain('unavailableMessage("voice.clone")');
    expect(VOICE).not.toContain("Google Voice Replication — Access required");
  });

  it("is a note and not a control", () => {
    // A button that cannot work is worse than no button — the same rule that
    // kept a reference control off Music while Lyria was refusing audio.
    const at = VOICE.indexOf("voice-clone-gate");
    expect(at).toBeGreaterThan(-1);
    const block = VOICE.slice(at, at + 900);
    expect(block).not.toMatch(/<button|onClick=/);
  });
});

describe("what the music reference claims about itself", () => {
  it("is EXPERIMENTAL until it has run through a DEPLOYED function", () => {
    // A green suite is not a deploy. The owner asked for an end-to-end test
    // before this is called LIVE, and it has not had one.
    expect(CAPABILITIES["music.referenceAudio"].state).toBe("EXPERIMENTAL");
    expect(CAPABILITIES["music.referenceAudio"].evidence).toMatch(
      /a green test suite is not a deploy/i,
    );
  });

  it("still records that the audio door itself is shut", () => {
    // The two-stage route exists because Lyria refuses audio, and the flag in
    // musicCore.ts must keep saying so.
    expect(CAPABILITIES["music.referenceAudio"].evidence).toMatch(
      /Unsupported input mime type for this model/,
    );
  });
});
