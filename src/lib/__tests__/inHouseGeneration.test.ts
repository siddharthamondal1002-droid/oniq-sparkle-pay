// ONIQ generates its own media — pinned (owner directive 2026-08-27).
//
// "Remove the dependency on outsourced generation services from the
// production video/movie pipeline." These pins hold the parts of that
// directive that are DONE, each against the file that actually decides
// it in production — a workflow env, a worker branch, a contract — so a
// later edit cannot quietly hand a stage back to a cloud provider.
//
// A stage still outsourced is NOT pinned here: this file states what is
// in-house, never what is intended.
//
// THE STILL STAGE LEFT, 2026-09-01, BY A LATER OWNER DIRECTIVE. "I want old
// version back where in-house and Veo both was there without gpu" — stills
// route to the Lovable gateway and the GPU leaves that path, because the GPU
// worker had never drawn a frame on the current endpoint and every film was
// dying at `still 1`. So the assertions below no longer say the still stage
// is in-house; saying so would be this file lying about production, which is
// the one thing it exists not to do.
//
// WHAT DID NOT CHANGE is the 2026-08-27 directive's actual content, and that
// is what the still block now pins instead: a stage may not SILENTLY
// outsource. One engine is chosen before anything is called, a chosen engine
// that is unavailable fails rather than falling through, and every reply
// names the engine that ran. Voice stays fully in-house and is pinned
// unchanged.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const STORY_WORKFLOW = read(".github/workflows/story-worker.yml");
const STORY_WORKER = read("remotion/scripts/story-worker.mjs");
const LOCAL_TTS = read("remotion/scripts/localTts.mjs");
const STORY_STILL = read("supabase/functions/story-still/index.ts");

describe("voice is ONIQ's own", () => {
  it("every production film speaks with the in-house engine, not a cloud bucket", () => {
    // 'only' is checked before the first line is spoken, so a film never
    // starts on a provider it would have to fall back from.
    expect(STORY_WORKFLOW).toMatch(/STORY_LOCAL_TTS:\s*only/);
    expect(STORY_WORKER).toContain("process.env.STORY_LOCAL_TTS === 'only' ? 'local' : 'cloud'");
  });

  it("the in-house voice is pinned by hash, not fetched by name", () => {
    // What was measured is what runs, or nothing runs.
    expect(LOCAL_TTS).toContain("sha256:");
    expect(LOCAL_TTS).toMatch(/PIPER_ASSETS/);
  });

  it("the in-house voice carries a cast, so characters stay distinct", () => {
    // A one-voice engine would silently flatten every character into the
    // narrator the moment the cloud path stopped being the default.
    expect(LOCAL_TTS).toMatch(/libritts/i);
    expect(STORY_WORKER).toContain("synthLocal");
    expect(STORY_WORKER).toContain("speakerFor");
  });
});

describe("stills are ONIQ's own", () => {
  it("keeps ONIQ's own engine reachable, whichever one is currently default", () => {
    // The GPU path is not deleted by the 2026-09-01 directive, it is
    // deselected: STILL_PROVIDER=in_house puts it back with no code change.
    expect(STORY_STILL).toContain("generateStill(");
    expect(STORY_STILL).toContain("submitStill(");
    expect(STORY_STILL).toContain('Deno.env.get("RUNPOD_ENDPOINT_ID")');
  });

  it("admits exactly two engines, and no third provider has crept in", () => {
    // The 2026-08-27 list, minus the one the owner chose. Anything else
    // appearing in this file is a provider nobody decided on.
    for (const provider of ["googleapis", "generativelanguage", "openai.com", "replicate"]) {
      expect(STORY_STILL.toLowerCase(), provider).not.toContain(provider.toLowerCase());
    }
  });

  it("picks ONE engine up front — never as a reaction to a failure", () => {
    // This is the whole of the 2026-08-27 directive that survives, and it is
    // the half that was load-bearing: silent outsourcing is what it ended.
    // Ordering is the guard. A route decided after the ask is parsed could be
    // re-decided by a failure; a route decided before it cannot.
    const routeAt = STORY_STILL.indexOf("const route = routeStill(");
    const bodyAt = STORY_STILL.indexOf("const body = await req.json()");
    expect(routeAt).toBeGreaterThan(-1);
    expect(routeAt).toBeLessThan(bodyAt);
    // And an unavailable engine fails instead of handing the work over. The
    // router says so; the handler stops on it.
    expect(STORY_STILL).toContain('route.engine === "blocked"');
    const ROUTER = read("supabase/functions/_shared/stillRoute.ts");
    expect(ROUTER).toContain('{ engine: "blocked", reason: "gateway-not-configured" }');
    expect(ROUTER).toContain('{ engine: "blocked", reason: "in-house-not-configured" }');
  });

  it("a failed still fails clearly rather than reaching for the other engine", () => {
    // The directive's sharpest rule, and the one place a "well, try the other
    // one" would ever be written — engineFailure is the only function that
    // sees every engine's failures.
    const at = STORY_STILL.indexOf("function engineFailure(");
    expect(at).toBeGreaterThan(-1);
    const handler = STORY_STILL.slice(at);
    expect(handler).toContain("502");
    for (const call of ["drawStillViaGateway", "generateStill(", "submitStill("]) {
      expect(handler, call).not.toContain(call);
    }
    // This file may still open a socket to nowhere of its own choosing. The
    // gateway's host is a constant in _shared/gatewayImage.ts, not a string
    // assembled here — which is what keeps "which provider" reviewable in one
    // place instead of buried in a request builder.
    const urls = STORY_STILL.match(/https?:\/\/[^"'`\s]+/g) ?? [];
    for (const url of urls) {
      expect(url, url).toMatch(/^https:\/\/(api\.runpod\.ai|ai\.gateway\.lovable\.dev|\$\{)|auth\/v1\/user/);
    }
  });

  it("inline reference bytes are refused honestly, never quietly ignored", () => {
    expect(STORY_STILL).toMatch(/Inline reference bytes are not accepted[\s\S]{0,500}422/);
  });

  it("the refusal names the CAPABILITY, so nobody can mistake it for a verdict on the prompt", () => {
    // MEASURED 2026-08-31. The refusal used to be a bare 422, and the ask
    // ladder reads a bare 422 as "the CONTENT was refused, step down" — so a
    // shot whose character reference had resolved SUCCESSFULLY was demoted to
    // rung 2, `a place with no people in it`. A capability the engine lacks
    // was charged against the shot's subject matter, and the person the shot
    // was about was redrawn as an empty landscape.
    const at = STORY_STILL.indexOf("Inline reference bytes are not accepted");
    const refusal = STORY_STILL.slice(at, at + 500);
    expect(refusal).toContain("CAPABILITY_MARKER");
    expect(refusal).toMatch(/promptRefused:\s*false/);
    // A FIELD, not a sentence. The previous signal was English prose, and
    // matching on prose is how the confusion survived.
    expect(STORY_STILL).toContain('from "../_shared/referenceOutcome.ts"');
  });
});
