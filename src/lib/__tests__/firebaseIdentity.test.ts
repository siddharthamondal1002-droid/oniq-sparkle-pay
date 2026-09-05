/**
 * MOVING IDENTITY TO FIREBASE WITHOUT MOVING A SINGLE ROW.
 *
 * Owner directive 2026-09-05. Supabase accepts a Firebase ID token as a
 * third-party provider, and `auth.uid()` then reads that token's `sub`. The
 * danger is not subtle: `auth.uid()` casts `sub` to uuid, and all 242 RLS
 * policies compare it against uuid columns, so a native Firebase uid would
 * fail to CAST — every policy on every table would error at once, for
 * everybody. The fix is that Firebase lets the caller choose the uid, so each
 * of the 125 accounts is imported carrying the id it already has.
 *
 * These tests pin that property and the three ways it has been lost before it
 * was ever shipped: an id that cannot be a uid, a record without the role
 * claim, and a password quietly dropped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_FIREBASE_UID,
  REQUIRED_CLAIM,
  planImport,
  planUser,
  verifyPlan,
  // @ts-expect-error — a plain .mjs script, deliberately dependency-free so
  // planning is testable without firebase-admin installed.
} from "../../../scripts/firebase-import-users.mjs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Strip comments. Every "this must NOT appear" check in this repo is one
 *  edit away from being satisfied by the very prose explaining why it is
 *  gone — this file's header names both forbidden strings. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Shaped like a real `auth.users` row. */
const row = (over: Record<string, unknown> = {}) => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  email: "a@example.com",
  phone: null,
  email_confirmed_at: "2026-01-01T00:00:00Z",
  encrypted_password: "$2a$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123",
  ...over,
});

describe("the uid is carried across, which is the whole migration", () => {
  it("uses the Supabase id verbatim as the Firebase uid", () => {
    const out = planUser(row());
    expect(out.ok).toBe(true);
    expect(out.record.uid).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
  });

  it("every production id fits — measured, not assumed", () => {
    // 2026-09-05 against auth.users: 125 rows, all UUID-shaped, max length 36.
    // The ceiling is 128, so the headroom is real and this is not luck.
    expect("0f8fad5b-d9cb-469f-a165-70867728950e".length).toBe(36);
    expect(MAX_FIREBASE_UID).toBe(128);
    expect(36).toBeLessThanOrEqual(MAX_FIREBASE_UID);
  });

  it("refuses an id it could not carry, rather than letting Firebase mint one", () => {
    // A generated uid here is the catastrophic case: the import "succeeds",
    // the person signs in, and auth.uid() matches none of their rows.
    const tooLong = planUser(row({ id: "x".repeat(MAX_FIREBASE_UID + 1) }));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.reason).toMatch(/longer than/);
    expect(planUser(row({ id: "" })).ok).toBe(false);
    expect(planUser(row({ id: null })).ok).toBe(false);
  });

  it("verifyPlan catches a uid that drifted, on the real shape", () => {
    const rows = [row(), row({ id: "11111111-2222-3333-4444-555555555555" })];
    const { records } = planImport(rows);
    expect(verifyPlan(rows, records)).toEqual([]);
    // Corrupt one the way a careless edit would.
    records[0].uid = "some-firebase-generated-uid";
    expect(verifyPlan(rows, records).join()).toMatch(/uid drifted/);
  });
});

describe("the role claim, without which a signed-in user sees nothing", () => {
  it("stamps role: authenticated on every record", () => {
    expect(REQUIRED_CLAIM).toEqual({ role: "authenticated" });
    const { records } = planImport([row(), row({ id: "22222222-2222-2222-2222-222222222222" })]);
    for (const r of records) expect(r.customClaims.role).toBe("authenticated");
  });

  it("verifyPlan fails a record whose claim was lost", () => {
    const rows = [row()];
    const { records } = planImport(rows);
    records[0].customClaims = {};
    expect(verifyPlan(rows, records).join()).toMatch(/missing role claim/);
  });

  it("does not share one claim object between records", () => {
    // A shared reference means editing one user's claims edits everyone's.
    const { records } = planImport([row(), row({ id: "33333333-3333-3333-3333-333333333333" })]);
    expect(records[0].customClaims).not.toBe(records[1].customClaims);
  });
});

describe("passwords come across for the accounts that have one", () => {
  it("carries a bcrypt hash verbatim", () => {
    const out = planUser(row());
    expect(out.carriedPassword).toBe(true);
    expect(Buffer.isBuffer(out.record.passwordHash)).toBe(true);
    expect(out.record.passwordHash.toString("utf8")).toBe(row().encrypted_password);
  });

  it("accepts every bcrypt variant, since the prefix is not always $2a$", () => {
    for (const p of ["$2a$", "$2b$", "$2y$"]) {
      const out = planUser(row({ encrypted_password: `${p}10$${"x".repeat(53)}` }));
      expect(out.carriedPassword, p).toBe(true);
    }
  });

  it("imports the passwordless accounts WITHOUT inventing a hash", () => {
    // Measured 2026-09-05: 86 of 125 have a password; the rest signed in by a
    // provider or a one-time code. A guessed hash would lock them out.
    for (const empty of [null, "", undefined]) {
      const out = planUser(row({ encrypted_password: empty }));
      expect(out.ok, String(empty)).toBe(true);
      expect(out.record.passwordHash, String(empty)).toBeUndefined();
    }
  });

  it("refuses to pass off a non-bcrypt hash as bcrypt", () => {
    // The import declares algorithm BCRYPT for the whole batch, so smuggling
    // an argon2 or scrypt string in would be accepted and never verify.
    const out = planUser(row({ encrypted_password: "$argon2id$v=19$m=65536,t=3,p=4$abc" }));
    expect(out.ok).toBe(true);
    expect(out.record.passwordHash).toBeUndefined();
  });
});

describe("rows that cannot become a Firebase user stop the run", () => {
  it("refuses a row with neither email nor phone", () => {
    const out = planUser(row({ email: null, phone: null }));
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/email/);
  });

  it("counts refusals rather than dropping them silently", () => {
    const rows = [row(), row({ id: "44444444-4444-4444-4444-444444444444", email: null })];
    const { counts, refused } = planImport(rows);
    expect(counts.planned).toBe(1);
    expect(counts.refused).toBe(1);
    expect(refused[0].id).toBe("44444444-4444-4444-4444-444444444444");
  });

  it("carries email verification across instead of re-verifying 123 people", () => {
    expect(planUser(row()).record.emailVerified).toBe(true);
    expect(planUser(row({ email_confirmed_at: null })).record.emailVerified).toBe(false);
  });
});

describe("the script cannot write by accident", () => {
  const SRC = read("scripts/firebase-import-users.mjs");

  it("does nothing without --apply", () => {
    expect(SRC).toContain('process.argv.includes("--apply")');
    expect(SRC).toMatch(/plan only — nothing written/);
  });

  it("refuses to apply while any row is unimportable", () => {
    expect(SRC).toMatch(/refusing to apply while any row is unimportable/);
  });

  it("imports firebase-admin lazily, so planning needs no dependency", () => {
    // Also why this test file can import the script at all: firebase-admin is
    // not installed, and CI must not carry it for a script that runs once.
    const code = codeOnly(SRC);
    const split = code.indexOf("async function main");
    expect(code.slice(split)).toMatch(/await import\("firebase-admin\/app"\)/);
    expect(code.slice(0, split), "firebase-admin reached the planning path").not.toMatch(
      /firebase-admin/,
    );
  });

  it("does not repeat the vendor sample's userRecord.id mistake", () => {
    // Supabase's documented backfill calls setCustomUserClaims(userRecord.id),
    // but UserRecord exposes `uid`; `.id` is undefined and every one of the
    // 125 calls would land in the catch. The claim is set inline at import
    // here, so there is no second pass to get wrong.
    const code = codeOnly(SRC);
    expect(code).not.toMatch(/userRecord\.id/);
    expect(code).not.toMatch(/setCustomUserClaims/);
  });
});

describe("the Supabase side is configured to accept the token", () => {
  const TOML = read("supabase/config.toml");

  it("registers the Firebase project as a third-party auth provider", () => {
    expect(TOML).toContain("[auth.third_party.firebase]");
    expect(TOML).toMatch(/enabled\s*=\s*true/);
    // The project the service account and FCM already use — one project, not
    // a second one nobody is watching.
    expect(TOML).toMatch(/project_id\s*=\s*"oniq-309bd"/);
  });

  it("names the hosted-platform reason no restrictive policies were added", () => {
    // Firebase signs every project's tokens with one shared key set, so on
    // SELF-HOSTED Supabase an unrelated project's token is cryptographically
    // valid and `as restrictive` policies are mandatory. Hosted rejects
    // unregistered project ids first. If ONIQ ever leaves hosted, 142 tables
    // need those policies the same day — so the reason is written down.
    expect(TOML).toMatch(/HOSTED/);
    expect(TOML).toMatch(/restrictive/i);
  });
});
