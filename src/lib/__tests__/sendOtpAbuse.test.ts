/**
 * SECURITY + SPEND — send-otp is an unauthenticated endpoint that bills money.
 *
 * It cannot require a session: nobody is signed in when they ask for a sign-in
 * code. So the guards ARE the security, and on 2026-09-05 they did not hold.
 * What was there was a per-IP window, and it failed twice over:
 *
 *   1. The `RL` Map is module scope in a SERVERLESS isolate — its own copy per
 *      isolate, wiped on recycle, not shared across concurrent ones. The window
 *      was "5 per 60s per isolate", not per IP. (msg91-verify-session's own
 *      comment already said "per isolate"; nobody drew the conclusion.)
 *   2. It keyed on `x-forwarded-for`, whose leftmost element is supplied by the
 *      CALLER. A different value per request buys a fresh bucket every time.
 *
 * Either one alone makes it bypassable, and every request past it sends a real
 * MSG91 SMS billed to ONIQ, to any phone number the caller names.
 *
 * The fix is a cooldown in POSTGRES keyed on the normalised phone — shared
 * across isolates, and the one field a caller cannot forge, because it is also
 * where the message goes. `otp_attempts.phone` is already the PRIMARY KEY, so
 * it needed no column, no index and no migration.
 *
 * Source-level, the convention this repo uses for edge guards (they run on Deno,
 * outside tsconfig, and the real path needs a service role and an SMS balance).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "supabase/functions/send-otp/index.ts"), "utf8");

/** The cooldown gate, whole. Every ordering check anchors on this exact text. */
const GATE = "if (since < RESEND_COOLDOWN_MS) {";

describe("the per-phone cooldown is durable", () => {
  it("reads the last send from Postgres, not from process memory", () => {
    expect(SRC).toMatch(/from\("otp_attempts"\)/);
    expect(SRC).toMatch(/\.select\("created_at"\)/);
    expect(SRC).toMatch(/\.eq\("phone", phone\)/);
    expect(SRC).toMatch(/RESEND_COOLDOWN_MS/);
  });

  it("refuses with 429 and says how long to wait", () => {
    // The EXACT statement, not a substring of it. Mutation testing caught this:
    // `if (false && since < RESEND_COOLDOWN_MS)` still contains
    // `since < RESEND_COOLDOWN_MS`, so a loose match let a gate that had been
    // switched off read as present and all nine tests passed. A grep guard
    // cannot detect an arbitrary neutered condition, but pinning the whole
    // statement means disabling it has to LOOK like disabling it.
    expect(SRC).toContain(GATE);
    expect(SRC).toMatch(/retry_after_seconds/);
    expect(SRC).toMatch(/status: 429/);
  });

  it("fails CLOSED when the lookup itself fails", () => {
    // An unreachable database means the cooldown cannot be evaluated. Sending
    // anyway is how a database blip becomes an SMS bill.
    const err = SRC.indexOf("if (lastErr)");
    const send = SRC.indexOf("api.msg91.com");
    expect(err).toBeGreaterThan(-1);
    expect(err).toBeLessThan(send);
    expect(SRC).toMatch(/status: 503/);
  });
});

describe("a throttled request costs nothing", () => {
  // The ordering IS the control. A gate that runs after the row is written or
  // after the SMS is sent has already spent the thing it exists to protect.
  const gate = SRC.indexOf(GATE);
  const upsert = SRC.indexOf(".upsert({");
  const send = SRC.indexOf("api.msg91.com");
  // The CALL SITE, not the definition — `function sixDigitOtp(): string`
  // contains the substring `sixDigitOtp()` and sits above the handler entirely,
  // so a bare indexOf finds a position no request ever reaches.
  const mint = SRC.indexOf("const otp = sixDigitOtp();");

  it("gates before the SMS is sent", () => {
    expect(gate).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(send);
  });

  it("gates before a row is written", () => {
    expect(upsert).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(upsert);
  });

  it("gates before a code is even generated", () => {
    expect(mint).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(mint);
  });
});

describe("the code itself is unguessable", () => {
  it("comes from the CSPRNG, never Math.random", () => {
    // V8 seeds xorshift128+ per isolate and its outputs are recoverable from a
    // handful of observed values — so codes from one isolate would be
    // predictable from each other. This is the only secret the flow rests on.
    expect(SRC).toMatch(/crypto\.getRandomValues/);
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(code).not.toMatch(/Math\.random/);
  });

  it("rejects the short tail instead of taking a biased modulo", () => {
    // Re-derived from the source rather than restated, so a changed constant is
    // re-checked rather than re-copied.
    const m = SRC.match(/Math\.floor\((0x[0-9a-f]+) \/ (\d+)\) \* (\d+)/i);
    expect(m).not.toBeNull();
    const [max, div, mul] = [Number(m![1]), Number(m![2]), Number(m![3])];
    expect(div).toBe(900000); // 100000..999999 inclusive
    expect(mul).toBe(div); // the limit must be a whole multiple of the range
    const limit = Math.floor(max / div) * mul;
    expect(limit % div).toBe(0); // no partial bucket => every code equally likely
    expect(limit).toBeLessThanOrEqual(max);
    // The discarded tail must be a rounding remainder, not a real slice of draws.
    expect((max - limit) / max).toBeLessThan(0.0001);
  });
});

describe("the provider's error body stays server-side", () => {
  it("is logged, not returned", () => {
    // It can carry account and routing detail, and an unauthenticated caller is
    // the last audience for it.
    expect(SRC).toMatch(/console\.error\("msg91 sendhttp error"/);
    expect(SRC).not.toMatch(/detail: text/);
  });
});
