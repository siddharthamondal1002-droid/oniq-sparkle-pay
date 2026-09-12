/**
 * A CREDENTIAL IS ADMITTED BY ITS CLAIM, NOT BY ITS BYTES.
 *
 * `frontier-probe` is the only surface in ONIQ that holds `OPENAI_API_KEY`, so
 * it is the only thing that can answer what that key may call — and its own
 * header says the service role is admitted "so one deploy message can also
 * verify". That was false in practice. The gate compared the bearer token to
 * the platform's injected `SUPABASE_SERVICE_ROLE_KEY` with `===`, and measured
 * 2026-09-12 through `pg_net`, neither vault key equals it:
 *
 *     email_queue_service_role_key (JWT)      -> 401
 *     story_dispatch_service_role_key (opaque) -> 401
 *     no authorization header                  -> 401
 *
 * Three identical answers means the branch was unreachable from the database
 * and indistinguishable from holding no credential at all — the same shape as
 * the watchdog bug `ops_watch_pick_key()` records, where detection worked and
 * announcement was dead. `send-push` and `ops-alert` both read the `role`
 * claim; this asserts `frontier-probe` does too.
 *
 * COMMENTS ARE STRIPPED FIRST, and here that is load-bearing rather than
 * habitual: the comment beside the gate QUOTES both `token === serviceRole`
 * and the claim it replaced, so a raw read would find every string it is
 * looking for in the prose explaining why the prose is there.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "../../test/sourceText.ts";

const SRC = resolve(__dirname, "../../../supabase/functions/frontier-probe/index.ts");
const code = () => stripComments(readFileSync(SRC, "utf8"));

describe("frontier-probe admits the service role by claim", () => {
  it("reads the role claim, and does not rely on byte equality alone", () => {
    const src = code();
    expect(src).toContain('roleClaim(token) === "service_role"');
    // The equality stays as a SECOND path — an edge function holding the
    // platform variable is a legitimate caller whose token may not be a JWT.
    expect(src).toContain("token === serviceRole");
    // …but it may not be the only thing the gate consults.
    const gate = src.slice(src.indexOf("const isServiceRole"));
    const line = gate.slice(0, gate.indexOf(";"));
    expect(line).toContain("roleClaim");
  });

  it("the decoder refuses anything that is not a three-part token", () => {
    const src = code();
    const fn = src.slice(src.indexOf("function roleClaim"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("parts.length !== 3");
    expect(body).toContain('return ""');
    // A non-string `role` must not be coerced: `String(undefined)` is the bug
    // shape this repo has already paid for once in the health contract.
    expect(body).toContain('typeof body.role === "string"');
  });

  it("an unauthenticated caller is still refused before anything is read", () => {
    const src = code();
    const gate = src.slice(src.indexOf("const isServiceRole"));
    const refusal = gate.indexOf("if (!token) return json(401");
    const keyRead = gate.indexOf('Deno.env.get("OPENAI_API_KEY")');
    expect(refusal).toBeGreaterThan(-1);
    expect(keyRead).toBeGreaterThan(refusal);
  });
});
