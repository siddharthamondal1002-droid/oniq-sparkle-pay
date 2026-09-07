/**
 * THE BODIES IN THIS FILE ARE MEASURED, NOT INVENTED.
 *
 * Every one was produced by an unauthenticated curl to the real Vertex host on
 * 2026-09-07, in the hour after the owner ran the first real POST and the probe
 * answered `{"status":404,"detail":"http 404","verdict":"UNEXPECTED 404 — read
 * the detail"}`. "Read the detail", and the detail was the status again.
 *
 * The cause is the first case below: aiplatform wraps the error in a JSON
 * ARRAY, so `parsed.error` is `undefined` and the shaped read yields nothing.
 * Everything else here exists so the fallback can never again be the status.
 */
import { describe, expect, it } from "vitest";
import { vertexErrorDetail } from "../../../supabase/functions/_shared/vertexError.ts";

/** Verbatim, POST https://aiplatform.googleapis.com/v1beta1/…/locations/global/voices */
const ARRAY_WRAPPED = `[{
  "error": {
    "code": 401,
    "message": "Request is missing required authentication credential. Expected OAuth 2 access token, login cookie or other valid authentication credential.",
    "status": "UNAUTHENTICATED"
  }
}]`;

/** The 2026-09-06 GET refusal, the shape the reader always handled. */
const PLAIN_OBJECT = `{"error":{"code":403,"message":"Permission 'aiplatform.voices.list' denied on resource '//aiplatform.googleapis.com/projects/oniq-309bd/locations/global'.","status":"PERMISSION_DENIED"}}`;

describe("Google's words survive, whatever shape they arrive in", () => {
  it("the ARRAY wrapper — the shape that produced 'http 404'", () => {
    const d = vertexErrorDetail(JSON.parse(ARRAY_WRAPPED), ARRAY_WRAPPED, 401);
    expect(d).toContain("UNAUTHENTICATED");
    expect(d).toContain("missing required authentication credential");
    // The exact regression: a status restated as an explanation.
    expect(d).not.toBe("http 401");
  });

  it("the plain object still reads the same as it always did", () => {
    const d = vertexErrorDetail(JSON.parse(PLAIN_OBJECT), PLAIN_OBJECT, 403);
    expect(d).toBe(
      "PERMISSION_DENIED: Permission 'aiplatform.voices.list' denied on resource " +
        "'//aiplatform.googleapis.com/projects/oniq-309bd/locations/global'.",
    );
  });

  it("`error` as a bare string", () => {
    const body = `{"error":"Not Found"}`;
    expect(vertexErrorDetail(JSON.parse(body), body, 404)).toBe("Not Found");
  });

  it("AN UNKNOWN SHAPE HANDS BACK THE RAW BODY, never the status", () => {
    // The whole point. Any refusal Google invents next is still readable.
    const body = `{"code":404,"reason":"voice replication is not enabled for this project"}`;
    const d = vertexErrorDetail(JSON.parse(body), body, 404);
    expect(d).toContain("voice replication is not enabled");
    expect(d).not.toMatch(/^http \d+$/);
  });

  it("an empty body says it is empty, and says that is what happened", () => {
    // Measured: POST to the v1 (not v1beta1) path returns 404 with no body at
    // all. Distinguishable from a refusal with words, which is the point.
    expect(vertexErrorDetail(null, "", 404)).toBe("http 404 with an empty body");
  });

  it("never returns a bare status for anything that carried text", () => {
    const bodies = [ARRAY_WRAPPED, PLAIN_OBJECT, `{"error":"x"}`, `{"unknown":true}`, `plain text`];
    for (const b of bodies) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(b);
      } catch {
        parsed = null;
      }
      expect(vertexErrorDetail(parsed, b, 404), `bare status for: ${b}`).not.toMatch(/^http \d+$/);
    }
  });

  it("truncates, so one refusal cannot flood a screen", () => {
    const long = "x".repeat(5000);
    expect(vertexErrorDetail(null, long, 500).length).toBe(500);
  });
});
