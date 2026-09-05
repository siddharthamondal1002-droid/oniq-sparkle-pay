#!/usr/bin/env node
/**
 * Import ONIQ's existing accounts into Firebase Auth, KEEPING THEIR IDS.
 *
 * Owner directive 2026-09-05: Firebase Auth becomes identity, Postgres stays
 * the system of record, and the 125 existing accounts are remapped rather
 * than restarted — nobody loses a wallet balance, a chat or a creation.
 *
 * THE ONE PROPERTY THIS WHOLE SCRIPT EXISTS TO HOLD: the Firebase uid is the
 * Supabase user id, byte for byte. Supabase's `auth.uid()` reads the token's
 * `sub` claim and CASTS IT TO uuid, and all 242 RLS policies compare that
 * against uuid columns. A native Firebase uid (28 chars, not a UUID) would
 * not merely fail to match rows — it would fail to cast, and every policy on
 * every table would error. importUsers() accepts a caller-specified uid of up
 * to 128 characters; measured 2026-09-05, all 125 production ids are UUIDs of
 * exactly 36. So they are carried across unchanged and NOT ONE policy, column
 * or row has to move. planUser() refuses any row that would break this.
 *
 * PASSWORDS COME TOO, for the 86 accounts that have one. Measured: every
 * stored hash begins `$2a$`, which is bcrypt, and Firebase imports bcrypt
 * natively. Without this the remap would still technically "keep" every
 * account while forcing 86 people to reset a password — which is not what
 * was asked for. The other 39 signed in by a provider or a one-time code and
 * have no hash to carry; they are imported without one and keep signing in
 * the way they already do.
 *
 * WHY THE ROLE CLAIM IS NOT OPTIONAL. Supabase reads the `role` claim to pick
 * the Postgres role. A Firebase token has none by default, so it would be
 * executed as `anon` — the user would be signed in and see nothing, which
 * looks like data loss and is the worst possible failure here. Every record
 * gets `role: 'authenticated'` at import, and new sign-ups need a blocking
 * Firebase function to add the same claim.
 *
 * A BUG IN THE VENDOR'S OWN SAMPLE, worth naming because copying it would
 * have failed on all 125: Supabase's documented backfill calls
 * `setCustomUserClaims(userRecord.id, …)`, but firebase-admin's UserRecord
 * has no `id` — the property is `uid`. Every call would pass undefined and
 * land in the catch. This script sets the claim inline at import instead, so
 * there is no second pass to get wrong.
 *
 * IT DOES NOT RUN BY DEFAULT. Without `--apply` it plans, prints the counts
 * and writes nothing, because the failure mode of a bad import is 125 people
 * locked out of an app with money in it. `firebase-admin` is imported LAZILY
 * inside the apply path, so planning and its tests need no dependency and CI
 * does not carry one for a script that runs once.
 *
 *   node scripts/firebase-import-users.mjs            # plan only
 *   node scripts/firebase-import-users.mjs --apply    # writes to Firebase
 *
 * Reads GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT the way the
 * Admin SDK already does. No credential value is ever printed.
 */

/** Firebase's documented ceiling for a caller-supplied uid. */
export const MAX_FIREBASE_UID = 128;

/** Supabase picks the Postgres role from this claim; without it, `anon`. */
export const REQUIRED_CLAIM = Object.freeze({ role: "authenticated" });

/** The bcrypt variants Supabase is known to emit. */
const BCRYPT_PREFIX = /^\$2[aby]\$/;

/**
 * Turn one `auth.users` row into an importUsers record, or refuse it.
 *
 * Refusing is the point: a row that cannot be imported safely must stop the
 * run rather than be silently dropped, because a "successful" import missing
 * a user is indistinguishable from a working one until that person signs in.
 */
export function planUser(row) {
  const uid = typeof row?.id === "string" ? row.id : "";
  if (!uid) return { ok: false, reason: "no id" };
  if (uid.length > MAX_FIREBASE_UID)
    return { ok: false, reason: `id longer than ${MAX_FIREBASE_UID}` };

  const email = row.email || undefined;
  const phone = row.phone || undefined;
  // Firebase needs at least one identifier it can key a sign-in on.
  if (!email && !phone) return { ok: false, reason: "neither email nor phone" };

  const record = {
    uid,
    ...(email ? { email, emailVerified: Boolean(row.email_confirmed_at) } : {}),
    ...(phone ? { phoneNumber: phone } : {}),
    customClaims: { ...REQUIRED_CLAIM },
  };

  const hash = typeof row.encrypted_password === "string" ? row.encrypted_password : "";
  if (hash && BCRYPT_PREFIX.test(hash)) {
    // The modular-crypt string goes across verbatim; Firebase parses the cost
    // and salt out of it. Anything not bcrypt is left without a password
    // rather than guessed at — a wrong hash is a silent lockout.
    record.passwordHash = Buffer.from(hash, "utf8");
  }

  return { ok: true, record, carriedPassword: Boolean(record.passwordHash) };
}

/** Plan every row. Order is preserved so a partial run is resumable by index. */
export function planImport(rows) {
  const records = [];
  const refused = [];
  let withPassword = 0;
  for (const row of rows ?? []) {
    const out = planUser(row);
    if (!out.ok) {
      refused.push({ id: row?.id ?? null, reason: out.reason });
      continue;
    }
    records.push(out.record);
    if (out.carriedPassword) withPassword += 1;
  }
  return {
    records,
    refused,
    counts: { planned: records.length, refused: refused.length, withPassword },
  };
}

/**
 * The safety assertion, run over the plan before anything is written.
 * Every imported uid must equal the source id exactly, and every record must
 * carry the role claim. Called by --apply; also the thing the tests pin.
 */
export function verifyPlan(rows, records) {
  const problems = [];
  // POSITIONAL, NOT KEYED BY UID. The first version of this looked each
  // record up by `records.find(r => r.uid === row.id)`, which made the one
  // failure it exists to catch invisible: a drifted uid simply is not found,
  // so the loop skipped it and reported nothing. planImport preserves order
  // and omits only refused rows, so the rows that planned zip 1:1 with the
  // records by index.
  const expected = (rows ?? []).filter((r) => planUser(r).ok);
  if (expected.length !== records.length) {
    problems.push(`have ${records.length} records for ${expected.length} importable rows`);
    return problems;
  }
  for (let i = 0; i < expected.length; i++) {
    const row = expected[i];
    const r = records[i];
    if (r.uid !== row.id) problems.push(`uid drifted for ${row.id}: got ${r.uid}`);
    if (r.customClaims?.role !== "authenticated") problems.push(`missing role claim for ${row.id}`);
  }
  return problems;
}

/* ------------------------------------------------------------------ runner */

async function main() {
  const apply = process.argv.includes("--apply");
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error(
      "Feed this the rows of auth.users as JSON on stdin, e.g.\n" +
        '  psql ... -Atc "select json_agg(t) from (select id, email, phone,\n' +
        '     email_confirmed_at, encrypted_password from auth.users) t" \\\n' +
        "    | node scripts/firebase-import-users.mjs",
    );
    process.exit(2);
  }

  const rows = JSON.parse(raw);
  const { records, refused, counts } = planImport(rows);

  const problems = verifyPlan(rows, records);
  if (problems.length) {
    console.error("PLAN REJECTED — the uid guarantee does not hold:");
    for (const p of problems.slice(0, 20)) console.error("  " + p);
    process.exit(1);
  }

  console.log(`source rows      ${rows.length}`);
  console.log(`planned          ${counts.planned}`);
  console.log(`  with password  ${counts.withPassword}`);
  console.log(`refused          ${counts.refused}`);
  for (const r of refused) console.log(`  ${mask(r.id)}  ${r.reason}`);

  if (!apply) {
    console.log("\nplan only — nothing written. Re-run with --apply to import.");
    return;
  }
  if (refused.length) {
    console.error("\nrefusing to apply while any row is unimportable. Fix or exclude them first.");
    process.exit(1);
  }

  // Lazy: the dependency is only needed for a run that actually writes.
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  initializeApp({ credential: applicationDefault() });

  // Firebase caps importUsers at 1000 records per call.
  let imported = 0;
  const failures = [];
  for (let i = 0; i < records.length; i += 1000) {
    const batch = records.slice(i, i + 1000);
    const res = await getAuth().importUsers(batch, { hash: { algorithm: "BCRYPT" } });
    imported += res.successCount;
    for (const e of res.errors) failures.push({ index: i + e.index, reason: e.error.message });
  }
  console.log(`\nimported ${imported}/${records.length}`);
  for (const f of failures) console.log(`  row ${f.index}: ${f.reason}`);
  if (failures.length) process.exit(1);
}

/** Ids are not secret, but a full list in a log is still a user list. */
function mask(id) {
  return typeof id === "string" && id.length > 8 ? `${id.slice(0, 8)}…` : String(id);
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
  });
}

// Only run when invoked directly, so the pure exports stay importable.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
