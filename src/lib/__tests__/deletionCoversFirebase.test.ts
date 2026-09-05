/**
 * IF ONIQ KEEPS A FILE, DELETING THE ACCOUNT HAS TO DELETE IT.
 *
 * Owner directive 2026-09-05 has ONIQ retain a student's study attachments —
 * worksheets, textbook photos, answer sheets — in the Firebase bucket under
 * `users/{uid}/`. That store is reached by NOTHING else in this repo's
 * deletion path: Postgres rows go by 64 ON DELETE CASCADE FKs, Supabase
 * objects go by PURGE_BUCKETS, and a Firebase object is neither. So retention
 * without this is not a missing feature, it is the deletion promise being
 * false while still being made.
 *
 * These are source-level assertions on purpose. The real purge needs a service
 * account that exists only as a Supabase secret, so the behaviour is proven in
 * production by `deletion-proof` — which seeds a real object and fails if one
 * survives. What a unit test CAN hold is that the wiring is still there, since
 * the way this breaks is somebody deleting a call, not somebody writing a
 * subtly wrong loop.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  firebasePrefixFor,
  purgeFirebaseObjects,
} from "../../../supabase/functions/_shared/purgeUserData.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Strip comments, so prose about a call is not read as the call. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const UID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("the shared purge reaches the Firebase bucket", () => {
  const src = codeOnly(read("supabase/functions/_shared/purgeUserData.ts"));

  it("purgeUserData actually calls the Firebase purge", () => {
    // delete-account and dsr-handler's internal_purge both route through
    // purgeUserData, so this one call is what covers every deletion path.
    expect(src).toContain("purgeFirebaseObjects(uid)");
  });

  it("purges before deleting the auth user, not after", () => {
    // Ordering matters the same way it does for the Supabase buckets: once the
    // auth row is gone there is no longer anything tying the objects to a
    // person, so a failure after that point leaves orphans nobody can find.
    expect(src.indexOf("purgeFirebaseObjects(uid)")).toBeLessThan(
      src.indexOf("auth.admin.deleteUser(uid)"),
    );
  });

  it("never issues a delete for a path outside the owner's prefix", () => {
    // A listing is remote input. Even one, it must not be able to aim a delete
    // at somebody else's object.
    expect(src).toContain("startsWith(prefix)");
  });
});

describe("the prefix is a folder, not a substring", () => {
  it("ends in a slash", () => {
    // Without the trailing slash `users/<uid>` also prefixes `users/<uid>-x`,
    // and a purge would reach into a different person's folder — the same
    // mistake in the opposite direction from a listing that misses files.
    expect(firebasePrefixFor(UID)).toBe(`users/${UID}/`);
    expect(firebasePrefixFor(UID).endsWith("/")).toBe(true);
  });
});

describe("an environment with no service account still deletes cleanly", () => {
  it("reports rather than throws when Firebase is not configured", async () => {
    // CI and the dev container hold no FIREBASE_SERVICE_ACCOUNT. Deletion must
    // not become impossible there — an account that cannot be deleted is a
    // worse outcome for the person asking than one deleted with a residue
    // reported, which is why the purge is best-effort and the proof is what
    // makes the claim.
    const r = await purgeFirebaseObjects(UID);
    expect(r.deleted).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.reason, "an unconfigured environment should say so").toBeTruthy();
  });
});

describe("the deletion proof asserts Firebase, or it proves nothing", () => {
  const src = codeOnly(read("supabase/functions/deletion-proof/index.ts"));

  it("seeds a real object in the Firebase bucket", () => {
    // A proof that only seeds where deletion already worked cannot fail for
    // the store that was just added.
    expect(src).toContain("uploadObject(");
    expect(src).toContain("firebasePrefixFor(uid)");
  });

  it("runs the SAME purge delete-account runs, not a copy", () => {
    // A copied loop is how a proof keeps passing after the real path drifts.
    expect(src).toContain("purgeFirebaseObjects(uid)");
  });

  it("counts anything left behind as a residue", () => {
    expect(src).toContain("listObjects(");
    expect(src).toMatch(/residues\.push\(\{\s*where:\s*`firebase:/);
  });
});
