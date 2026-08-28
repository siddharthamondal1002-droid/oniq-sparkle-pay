/**
 * A STORY MOVIE ASKS FOR MOTION, AND THE CLAIM SAYS SO.
 *
 * Owner directive 2026-08-28: a normal user-facing Story Movie generation
 * must reach ONIQ's own LTX motion engine without a manual service-role edit
 * before every run.
 *
 * What was broken was small and invisible: claim_story_seconds — the
 * SECURITY DEFINER function that creates every job — did not list motion_mode
 * in its INSERT, so every production job took the NULL default. Job e377f793
 * (2026-08-28) proved the cost of that: IN_HOUSE_MOTION reached the renderer,
 * the route resolved to the in-house engine, and the film still arrived as
 * nine stills because the clip stage had never been switched on.
 *
 * These tests pin the fix AND the guarantees it must not cost us. SQL and
 * edge functions run outside tsconfig, so they are asserted against source,
 * the same way the rest of this chain already is.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const claim = readFileSync(
  join(process.cwd(), "supabase/migrations/20260828190000_story_movie_motion_intent.sql"),
  "utf8",
);
const motionModeMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260822153000_story_jobs_motion_mode.sql"),
  "utf8",
);
const dispatch = readFileSync(
  join(process.cwd(), "supabase/functions/story-dispatch/index.ts"),
  "utf8",
);
const workflow = readFileSync(join(process.cwd(), ".github/workflows/story-worker.yml"), "utf8");
const worker = readFileSync(join(process.cwd(), "remotion/scripts/story-worker.mjs"), "utf8");
const route = readFileSync(
  join(process.cwd(), "supabase/functions/_shared/inHouseMotion.ts"),
  "utf8",
);

/** The clip-stage branch of generateClip, where the engine is chosen. */
const generateClip = worker.slice(
  worker.indexOf("async function generateClip("),
  worker.indexOf("Temporal-aliveness score"),
);

// A. a normal Story Movie now carries motion intent
describe("A — a normal Story Movie claim stamps motion intent", () => {
  it("the INSERT lists motion_mode, which is what it never did before", () => {
    expect(claim).toMatch(/insert into story_jobs \([^)]*motion_mode\)/s);
    expect(claim).toMatch(/coalesce\(_verbatim, false\), motion\)/);
  });

  it("movie grade with the switch on yields exactly 'select'", () => {
    expect(claim).toMatch(
      /motion := case when coalesce\(cfg\.motion_select, false\) and grade_clean = 'movie'\s*\n?\s*then 'select' else null end;/,
    );
  });

  it("'on' — a clip for every shot — is still unreachable from data", () => {
    // Only 'select' is ever written, and the column's CHECK refuses the rest.
    expect(claim).not.toMatch(/motion_mode\s*=\s*'on'/);
    expect(claim).not.toMatch(/then 'on'/);
    expect(motionModeMigration).toMatch(/check \(motion_mode is null or motion_mode = 'select'\)/);
  });

  it("dispatch forwards it and the workflow reads it from the payload alone", () => {
    expect(dispatch).toMatch(
      /const motionMode = rows\[0\]\.motion_mode === "select" \? "select" : null;/,
    );
    expect(workflow).toMatch(
      /STORY_MOVIE: \$\{\{ github\.event\.client_payload\.story_movie \|\| '' \}\}/,
    );
  });
});

// B/J. the engine choice still belongs to IN_HOUSE_MOTION alone
describe("B, J — the engine is chosen by IN_HOUSE_MOTION, and only when on", () => {
  it("in-house is returned only with the switch on and the worker healthy", () => {
    expect(route).toMatch(/if \(!c\.inHouseEnabled\) return \{ engine: "premium", level: 5 \};/);
    expect(route).toMatch(/return \{ engine: "in-house", level: 4 \};/);
  });

  it("IN_HOUSE_MOTION off can never reach the in-house branch", () => {
    // routeMotion returns premium first; generateClip's in-house branch is
    // guarded on that exact value, so LTX cannot be invoked with it off.
    expect(generateClip).toMatch(/if \(route\.engine === 'in-house'\)/);
    expect(worker).toMatch(/inHouseEnabled: process\.env\.IN_HOUSE_MOTION === 'on'/);
  });
});

// C/D. no other provider may be substituted
describe("C, D — neither Google nor WAN is selected", () => {
  it("the in-house branch calls ONIQ's own transport, never story-clip", () => {
    const inHouse = generateClip.slice(
      generateClip.indexOf("route.engine === 'in-house'"),
      generateClip.indexOf("const prompt = composeVideoPrompt"),
    );
    expect(inHouse).toContain("edge('story-motion'");
    expect(inHouse).not.toContain("edge('story-clip'");
    expect(inHouse).toContain("no provider fallback");
  });

  it("a blocked route refuses instead of falling back to a provider", () => {
    expect(generateClip).toMatch(
      /in-house motion unavailable \(\$\{route\.reason\}\) — no provider fallback/,
    );
  });

  it("nothing in this change names WAN as a provider", () => {
    // Word-boundary, not substring: `wanted` is the requested-seconds
    // variable and matching it would make this assertion noise rather than
    // a guard.
    for (const source of [claim, dispatch]) {
      expect(source).not.toMatch(/\bwan\b/i);
      expect(source).not.toMatch(/\bwan[-_]?\d/i);
    }
  });
});

// E/F. the browser still chooses no infrastructure
describe("E, F — the client selects no infrastructure and cannot write the flag", () => {
  it("the claim takes no new parameter, so no client field can carry intent", () => {
    expect(claim).toMatch(
      /claim_story_seconds\(_requested_seconds integer, _prompt text, _grade text DEFAULT 'movie'::text, _verbatim boolean DEFAULT false\)/,
    );
  });

  it("the value is derived from config and the validated grade only", () => {
    expect(claim).toMatch(/coalesce\(cfg\.motion_select, false\) and grade_clean = 'movie'/);
    // grade_clean is validated from the request before anything else.
    expect(claim).toMatch(/grade_clean := case when _grade = 'movie' then 'movie' else null end;/);
  });

  it("no GPU, provider, model, endpoint, budget or runtime is client-selectable here", () => {
    for (const forbidden of ["gpu", "runpod", "endpoint", "provider", "budget", "model"]) {
      expect(claim.toLowerCase()).not.toContain(`_${forbidden}`);
    }
  });

  it("motion_mode remains service-role-only — no client write policy exists", () => {
    expect(motionModeMigration).toMatch(/story_jobs carries no INSERT or UPDATE/);
    expect(claim).not.toMatch(/create policy/i);
  });
});

// G. an ordinary still-only Story stays still-only
describe("G — the switch off returns every Story to still-only", () => {
  it("motion is null when the owner turns the switch off", () => {
    expect(claim).toMatch(/coalesce\(cfg\.motion_select, false\)/);
    expect(claim).toMatch(/then 'select' else null end;/);
  });

  it("a null motion_mode sends nothing and the clip stage stays off", () => {
    expect(dispatch).toMatch(/\.\.\.\(motionMode \? \{ story_movie: motionMode \} : \{\}\)/);
    expect(workflow).toMatch(/client_payload\.story_movie \|\| ''/);
  });

  it("the kill switch needs no deploy — it is a config column", () => {
    expect(claim).toMatch(
      /alter table public\.story_config\s*\n\s*add column if not exists motion_select boolean not null default true;/,
    );
  });
});

// H/I. the guards that stop double spend are untouched
describe("H, I — duplicate submission and the budget gates still hold", () => {
  it("the row lock that makes two taps one job is still taken", () => {
    expect(claim).toMatch(/from story_allowance where user_id = me for update;/);
    expect(claim).toMatch(/from story_global_usage where day = today for update;/);
  });

  it("the config kill switch and the duration band still refuse first", () => {
    expect(claim).toMatch(/if not cfg\.enabled then/);
    expect(claim).toMatch(/'story-duration-estimate-out-of-band'/);
    expect(claim).toMatch(
      /wanted := greatest\(cfg\.min_story_seconds, least\(cfg\.max_story_seconds/,
    );
  });

  it("authentication is still the first thing checked", () => {
    expect(claim).toMatch(/if me is null then raise exception 'not authenticated'; end if;/);
  });
});

// K. the intent actually reaches generateClip
describe("K — the intent reaches generateClip", () => {
  it("'select' opens the clip stage, which is the only caller", () => {
    expect(worker).toMatch(
      /job\.grade === 'movie' && \(process\.env\.STORY_MOVIE === 'on' \|\| process\.env\.STORY_MOVIE === 'select'\)/,
    );
    expect(worker).toMatch(/if \(motionPlan\?\.attemptClip\)/);
    const call = worker.slice(worker.indexOf("if (motionPlan?.attemptClip)"));
    expect(call.slice(0, 600)).toMatch(/await generateClip\(/);
  });

  it("the whole chain is present, claim to LTX transport", () => {
    expect(claim).toContain("motion_mode"); // claim stamps it
    expect(dispatch).toContain("story_movie"); // dispatch forwards it
    expect(workflow).toContain("STORY_MOVIE"); // workflow passes it
    expect(worker).toContain("STORY_MOVIE"); // worker gates on it
    expect(generateClip).toContain("edge('story-motion'"); // and calls in-house
  });
});
