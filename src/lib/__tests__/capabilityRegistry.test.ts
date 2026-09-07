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
  it("is LIVE only because it ran through the DEPLOYED function", () => {
    // A green suite is not a deploy, and this entry sat at EXPERIMENTAL
    // saying exactly that until 2026-09-04, when one POST to the deployed
    // music-generate on production came back 200 with a real brief. The
    // evidence has to carry that run, not a reference to the test suite.
    const e = CAPABILITIES["music.referenceAudio"];
    expect(e.state).toBe("LIVE");
    expect(e.evidence).toMatch(/PROVEN END TO END ON PRODUCTION/);
    expect(e.evidence).toContain("HTTP 200");
    expect(e.evidence).toContain("384,044 bytes");
  });

  it("keeps the brief that proved it, not just the status code", () => {
    // A 200 alone would not separate "the chain ran" from "Lyria wrote
    // something and the reference was quietly dropped". The brief is the
    // discriminator, so it is quoted verbatim and pinned here.
    const e = CAPABILITIES["music.referenceAudio"].evidence;
    expect(e).toContain("Ambient, Electronic");
    expect(e).toContain("synthesizer, pad");
    // Its SHAPE is describeBrief's, which is what proves the parse ran.
    expect(e).toMatch(/describeBrief's exactly/);
    // And the words came from the AUDIO, not from the prompt or the mood
    // chip — the thing that separates listening from paraphrasing.
    expect(e).toMatch(/could only have come from the audio/i);
  });

  it("still records that the audio door itself is shut", () => {
    // The two-stage route exists because Lyria refuses audio, and the flag in
    // musicCore.ts must keep saying so.
    expect(CAPABILITIES["music.referenceAudio"].evidence).toMatch(
      /Unsupported input mime type for this model/,
    );
  });
});

/**
 * "BUILT AND UNIT-TESTED" IS NOT "REACHABLE", and this pins the difference.
 *
 * `voice.clone`'s evidence used to end "admission is now the ONLY thing
 * between here and a working feature". Measured 2026-09-06, that was wrong by
 * one: no deployed function imported `voiceReplication.ts` at all, so the
 * helpers were pure and nothing called them.
 *
 * THE ASSERTION BELOW IS NOW THE INVERSE OF WHAT IT WAS, and that is the guard
 * doing its job rather than being edited around. It pinned the GAP, and it
 * went red the moment `voice-clone` was written — which is exactly when the
 * evidence needed rewriting, because a GATED capability whose blockers have
 * changed is the single most misleading row this registry can hold.
 *
 * AND IT FIRST WENT RED FOR THE WRONG REASON. `grep -rl voiceReplication` over
 * raw source also matched `firebase-provisioning`, whose only mention of it is
 * a COMMENT saying nothing imports it. That is the fourth prose match in this
 * repo in two days — good comments quote the code they discuss, so any grep
 * strict enough to be useful will hit them. The search is over IMPORT
 * STATEMENTS now, not over text.
 */
describe("voice.clone: the wiring is pinned, not just the allowlist", () => {
  const FN_DIR = join(ROOT, "supabase/functions");

  it("exactly one deployed function imports voiceReplication", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (name === "index.ts") out.push(full);
      }
      return out;
    };
    const importers = walk(FN_DIR)
      .filter((f) =>
        /^\s*import[\s\S]*?from\s+["'][^"']*voiceReplication\.ts["']/m.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map((f) => f.slice(ROOT.length + 1))
      .sort();
    expect(importers, "the replication helpers lost their caller").toEqual([
      "supabase/functions/voice-clone/index.ts",
    ]);
  });

  it("the minting call is a POST, which is the verb nobody used", () => {
    // Every measurement of this blocker was a GET of .../locations/global
    // /voices — a LIST. Minting is a POST to the same path and needs a
    // different permission, so months of "aiplatform.voices.list denied"
    // never tested the call the feature makes. This repo's own first rule is
    // that a catalogue says what exists and only a POST says what this key
    // may call; the voice work spent days ignoring it.
    const fn = read("supabase/functions/voice-clone/index.ts");
    const codeOnly = fn.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(codeOnly).toContain("voicesUrl(projectId)");
    expect(codeOnly, "the mint stopped being a POST").toMatch(/method:\s*["']POST["']/);
  });

  it("minting is gated on is_admin, because it spends the metered Google key", () => {
    // Vertex replication bills the owner's Google account, not Lovable
    // credits. Who may mint, how many a day and at what price are the owner's
    // to set, so until they do the gate is is_admin — and the gate sits ABOVE
    // the first line that can spend.
    const fn = read("supabase/functions/voice-clone/index.ts");
    const codeOnly = fn.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const gate = codeOnly.indexOf("is_admin");
    const spend = codeOnly.indexOf("googleAccessToken()");
    expect(gate, "the admin gate went missing").toBeGreaterThan(-1);
    expect(gate, "the admin gate sank below the credential").toBeLessThan(spend);
  });

  it("delete marks the row instead of removing it, so the cap cannot be reset", () => {
    // voice_clones IS the rolling-24h ledger and the counts do not filter on
    // status, so a hard DELETE would buy unmetered mints on the owner's key
    // for the price of a delete — the same hole image_jobs, music_jobs and
    // voice_jobs each carry a comment about.
    const fn = read("supabase/functions/voice-clone/index.ts");
    const codeOnly = fn.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(codeOnly).toContain('status: "deleted", voice_key: null');
    expect(codeOnly, "voice-clone gained a hard delete").not.toMatch(/\.delete\(\)/);
  });

  it("the mint probe has a caller, which is the bug this whole entry is about", () => {
    // voice-clone exists because voiceReplication.ts had no caller for two
    // days while the blocker was reported as Google's. Shipping a probe that
    // nothing invokes would repeat exactly that, one level up.
    const screen = read("src/routes/_authenticated/app.admin_.firebase.tsx");
    expect(screen).toContain('invoke("voice-clone"');
    expect(screen).toContain('action: "probe"');
    expect(screen, "the button's marker moved away from its handler").toContain(
      "voice-clone-probe",
    );
  });

  it("voice-generate can only ask for a BUILT-IN voice", () => {
    const fn = read("supabase/functions/voice-generate/index.ts");
    expect(fn).toContain("prebuiltVoiceConfig");
    // The replicated path passes a plain string called `voice` instead. Its
    // appearance means the feature moved and this row is stale.
    expect(fn).not.toMatch(/voice_config\s*:\s*\{\s*voice\s*:/);
  });

  it("the evidence says BOTH blockers, so nobody reads it as one", () => {
    const ev = CAPABILITIES["voice.clone"].evidence;
    expect(ev).toMatch(/TWO things stand between here and a working feature/i);
    expect(ev).toMatch(/only the owner can request/i);
  });
});
