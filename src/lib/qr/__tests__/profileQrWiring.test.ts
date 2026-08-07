/**
 * A3 wiring — the scan screen, the /q/ landing route, and the migration.
 *
 * The dispatch itself is unit-tested in oniqProfileQr.test.ts against the real
 * parseUpiUri. What is left is whether the app actually USES it correctly, and
 * that lives in a route component. vitest runs with environment: "node" here,
 * so these are source assertions rather than rendered ones — stated plainly
 * because a source assertion proves the code is written a certain way, not
 * that it behaves a certain way at runtime.
 *
 * They are still worth having: every property below is one where a later edit
 * would silently break a safety rule, and none of them would be caught by tsc.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SCAN = "src/routes/_authenticated/app.scan.tsx";
const LANDING = "src/routes/q.$token.tsx";
const MIGRATION = "supabase/migrations/20260807000000_profile_qr_tokens.sql";

describe("the scan screen asks about payment before anything else", () => {
  const code = stripComments(read(SCAN));

  it("routes the scan through resolveScannedCode", () => {
    expect(code).toMatch(/resolveScannedCode\(/);
  });

  it("handles the upi branch before the profile branch", () => {
    const upi = code.indexOf('scanned.kind === "upi"');
    const profile = code.indexOf('scanned.kind === "oniq-profile"');
    expect(upi, "no upi branch").toBeGreaterThan(-1);
    expect(profile, "no profile branch").toBeGreaterThan(-1);
    expect(upi, "the profile branch is checked before payment").toBeLessThan(profile);
  });

  it("still hands the FULL parsed object to the payment screen", () => {
    // parsed carries `raw`, and merchant QRs die without it — mc/tr/mode/sign
    // are fields ONIQ does not model, and a UPI app rejects the payment as
    // unverified P2P if they are dropped. Rebuilding a narrower object here
    // would be silent and would only fail at a real shop counter.
    expect(code).toMatch(/navigate\(\{\s*to:\s*"\/app\/upi",\s*search:\s*parsed\s*\}\)/);
  });

  it("never adds anyone straight from a scan", () => {
    // A scan is a request to LOOK at someone, not to connect to them. The Add
    // is an explicit tap on the page the scan lands on.
    expect(code).not.toMatch(/send_friend_request/);
  });

  it("sends a profile scan to the landing route", () => {
    expect(code).toMatch(/to:\s*"\/q\/\$token"/);
  });
});

describe("the /q/ landing route does not leak the token it resolves", () => {
  const src = read(LANDING);
  const code = stripComments(src);

  it("publishes no og:url, since that would broadcast the token", () => {
    // /u/<user_id> can afford an og:url. This route cannot: every scraper,
    // link unfurler and preview bot that touches the URL would then have a
    // copy of a code whose entire purpose is being revocable.
    expect(code).not.toMatch(/og:url/);
    // ...and the comment explaining why is expected to stay.
    expect(src).toMatch(/og:url/);
  });

  it("asks not to be indexed", () => {
    expect(code).toMatch(/noindex/);
  });

  it("still renders an OG card, which is the whole growth point", () => {
    expect(code).toMatch(/og:title/);
    expect(code).toMatch(/og:image/);
  });

  it("distinguishes a revoked code from a broken link", () => {
    // "This code was switched off" and "this page is broken" call for
    // different reactions from the person holding the phone.
    expect(code).toMatch(/isn&apos;t active|isn't active/);
  });

  it("adds nobody on arrival", () => {
    expect(code).not.toMatch(/send_friend_request/);
  });
});

describe("the migration keeps tokens out of reach", () => {
  const sql = read(MIGRATION);

  it("puts tokens in their own table, not on profiles", () => {
    // profiles has profiles_select_all USING (true) for authenticated, so a
    // column there would let any signed-in user harvest every token in one
    // query and revocation would mean nothing.
    expect(sql).toMatch(/create table if not exists public\.profile_qr_tokens/);
    expect(sql).not.toMatch(/alter table public\.profiles\s+add/i);
  });

  it("enables RLS and adds no policy", () => {
    expect(sql).toMatch(/alter table public\.profile_qr_tokens enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });

  it("revokes function access from PUBLIC, not just from the two roles", () => {
    // The bug this migration hit on its first run: Postgres grants EXECUTE on
    // every new function to PUBLIC, so revoking from anon/authenticated by
    // name removes grants they never had and leaves the function callable.
    // Every revoke of a function must name public.
    const revokes = sql.match(/revoke all on function[^;]*;/g) ?? [];
    expect(revokes.length).toBeGreaterThanOrEqual(4);
    for (const r of revokes) {
      expect(r, `revoke does not name public: ${r}`).toMatch(/from[^;]*\bpublic\b/);
    }
  });

  it("keeps the token generator callable by nobody", () => {
    expect(sql).toMatch(/revoke all on function public\.gen_profile_qr_token\(\)[^;]*\bpublic\b/);
    expect(sql).not.toMatch(/grant execute on function public\.gen_profile_qr_token/);
  });

  it("grants the resolver to anon, and only the resolver", () => {
    // A stranger's system camera has no session, so the resolver must be
    // reachable by anon. The other two would only ever raise
    // 'not authenticated' for it.
    expect(sql).toMatch(
      /grant execute on function public\.profile_card_by_qr_token\(text\)\s*to anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.my_profile_qr_token\(\)\s*to authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.rotate_profile_qr_token\(\)\s*to authenticated;/,
    );
  });

  it("is additive and carries its own down migration", () => {
    expect(sql).not.toMatch(/\bdrop table (?!if exists public\.profile_qr_tokens)/i);
    for (const line of [
      "drop table if exists public.profile_qr_tokens",
      "drop function if exists public.profile_card_by_qr_token(text)",
      "drop function if exists public.rotate_profile_qr_token()",
      "drop function if exists public.my_profile_qr_token()",
      "drop function if exists public.gen_profile_qr_token()",
    ]) {
      expect(sql, `down migration missing: ${line}`).toContain(line);
    }
  });

  it("constrains the token to the charset the client parser accepts", () => {
    // A token that cannot round-trip through the URL should never reach the
    // table. Same expression as TOKEN_RE in oniqProfileQr.ts.
    expect(sql).toMatch(/\^\[A-Za-z0-9_-\]\{16,64\}\$/);
    const client = read("src/lib/qr/oniqProfileQr.ts");
    expect(client).toMatch(/\^\[A-Za-z0-9_-\]\{16,64\}\$/);
  });
});

describe("the rotation copy does not overclaim", () => {
  const scan = read(SCAN);

  it("says the old code stops working, not that the profile is hidden", () => {
    // /u/<user_id> stays public after a rotation, so "refresh to become
    // unreachable" would be a promise the user could disprove in a minute.
    expect(scan).toMatch(/doesn&apos;t hide your\s+profile|does not hide your profile/);
  });

  it("makes rotation a confirmed action, not a stray tap", () => {
    // It is irreversible and it breaks codes already in the wild.
    expect(stripComments(scan)).toMatch(/setConfirming\(true\)/);
  });
});
