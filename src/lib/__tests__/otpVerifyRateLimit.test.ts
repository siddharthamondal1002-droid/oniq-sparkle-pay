/**
 * SECURITY (brute force) — msg91-verify-session must throttle verify attempts.
 *
 * The function takes an `access_token` from the request body and checks it
 * against MSG91. Without a gate, an attacker gets unlimited token guesses and
 * every guess spends an MSG91 verify call under our auth key. The fix is the
 * same per-IP limiter send-otp already ships (5 per 60s window → 429), placed
 * BEFORE any body parsing or MSG91 call so throttled requests cost nothing.
 *
 * Edge functions run on Deno (outside tsconfig), so the defending shape is
 * pinned in source — the same convention as the other edge guards here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "supabase/functions/msg91-verify-session/index.ts"),
  "utf8",
);

describe("msg91-verify-session brute-force gate", () => {
  it("carries the per-IP rate limiter", () => {
    expect(src).toMatch(/function rateLimited\(ip: string\): boolean/);
    expect(src).toMatch(/now - t < 60_000/);
    expect(src).toMatch(/arr\.length > 5/);
  });

  it("rejects throttled requests with 429", () => {
    expect(src).toMatch(/if \(rateLimited\(ip\)\)/);
    expect(src).toMatch(/status: 429/);
  });

  it("gates before the MSG91 verify call, not after", () => {
    // Throttled guesses must never reach MSG91 (each call spends our auth
    // key's quota). The limiter check has to appear earlier in the handler
    // than the verifyAccessToken fetch.
    const gate = src.indexOf("rateLimited(ip)");
    const upstream = src.indexOf("verifyAccessToken");
    expect(gate).toBeGreaterThan(-1);
    expect(upstream).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(upstream);
  });

  it("gates before the request body is even parsed", () => {
    const gate = src.indexOf("rateLimited(ip)");
    const parse = src.indexOf("await req.json()");
    expect(parse).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(parse);
  });
});
