/**
 * THE FUNCTION IS WIRED THE WAY THE ARCHITECTURE SAYS: flags before identity,
 * identity before the body, consent before a write, the ownership filter on
 * every query, an audit row on every mutation, marks instead of deletes.
 *
 * Read from source with comments stripped, because the function cannot run
 * in vitest (Deno.serve, esm.sh) and its comments quote every rule below.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import { NullAdapter, adapterFor } from "../../../supabase/functions/_shared/health/adapter.ts";
import { allHealthFlagsOff } from "../../../supabase/functions/_shared/health/flagNames.ts";
import { auditRpcArgs } from "../../../supabase/functions/_shared/health/audit.ts";

const ROOT = join(__dirname, "..", "..", "..");
const SRC = stripComments(
  readFileSync(join(ROOT, "supabase/functions/health-api/index.ts"), "utf8"),
);

function fnBody(name: string): string {
  const start = SRC.search(new RegExp(`(async )?function ${name}\\(`));
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\n(async )?function \w+\(|\n\/\* -+/);
  return SRC.slice(start, next === -1 ? undefined : start + 1 + next);
}

const MUTATING = [
  "actRecordsCreate",
  "actRecordsDelete",
  "actRecordsConfirm",
  "actRecordsReject",
  "actDocumentsRegister",
  "actDocumentsConfirm",
  "actDocumentsUrl",
  "actDocumentsDelete",
  "actConsentsGrant",
  "actConsentsRevoke",
  "actExport",
  "actPurge",
];

describe("gate order in Deno.serve", () => {
  it("reads the flags before the JWT, the JWT before the body, the body before dispatch", () => {
    const serve = SRC.slice(SRC.indexOf("Deno.serve("));
    const flags = serve.indexOf("readHealthConfig(");
    const jwt = serve.indexOf("auth.getUser()");
    const body = serve.indexOf("req.json()");
    const dispatch = serve.indexOf("handler(ctx, body)");
    expect(flags).toBeGreaterThan(-1);
    expect(flags).toBeLessThan(jwt);
    expect(jwt).toBeLessThan(body);
    expect(body).toBeLessThan(dispatch);
    expect(serve.indexOf("health_disabled")).toBeLessThan(jwt);
  });

  it("answers 503 while the row says off, before naming the caller", () => {
    expect(SRC).toMatch(/reason: "health_disabled", requestId \}, 503\)/);
  });
});

describe("every mutation is audited; every read is scoped", () => {
  it.each(MUTATING)("%s calls audit()", (name) => {
    expect(fnBody(name)).toMatch(/await audit\(/);
  });

  it("consent is required before a record or document is written", () => {
    for (const name of ["actRecordsCreate", "actDocumentsRegister"]) {
      const body = fnBody(name);
      const consent = body.indexOf('requireConsent(ctx, "store_records"');
      const insert = body.indexOf(".insert(");
      expect(consent, name).toBeGreaterThan(-1);
      expect(consent, name).toBeLessThan(insert);
      // A refusal is written to the audit chain too.
      expect(body).toMatch(/"refused"/);
    }
  });

  it("the region signal refuses before any write", () => {
    for (const name of ["actRecordsCreate", "actDocumentsRegister", "actConsentsGrant"]) {
      const body = fnBody(name);
      expect(body.indexOf("ctx.regionBlocked"), name).toBeLessThan(body.indexOf(".insert("));
    }
  });

  it("every health-table query carries the ownership filter or writes the caller's id", () => {
    const re =
      /\.from\("(health_records|health_documents|health_consents|health_audit|health_ai_requests|consent_records)"\)/g;
    const hits = [...SRC.matchAll(re)];
    expect(hits.length).toBeGreaterThan(20);
    for (let i = 0; i < hits.length; i++) {
      const start = hits[i].index!;
      const end = i + 1 < hits.length ? hits[i + 1].index! : SRC.length;
      const window = SRC.slice(start, Math.min(end, start + 900));
      const scoped =
        window.includes('.eq("user_id", ctx.userId)') || window.includes("user_id: ctx.userId");
      expect(scoped, `unscoped query at ${SRC.slice(start, start + 80)}`).toBe(true);
    }
    // The count helper takes its table as a variable and is checked by name.
    expect(SRC).toContain('await q.eq("user_id", ctx.userId)');
  });

  it("marks, never deletes, a health row", () => {
    expect(SRC).not.toMatch(/\.from\("health_\w+"\)\s*\.delete\(/);
    expect(SRC).toMatch(/status: "deleted", deleted_at: ctx\.now/);
  });

  it("never returns a storage path to a client", () => {
    expect(fnBody("documentOut")).not.toContain("storage_path");
    expect(fnBody("actExport")).not.toContain("storage_path");
    expect(fnBody("actDocumentsList")).not.toContain("storage_path");
  });

  it("mints 60-second read URLs and audits each one", () => {
    expect(SRC).toMatch(/const SIGNED_READ_SECONDS = 60;/);
    const body = fnBody("actDocumentsUrl");
    expect(body).toContain("createSignedUrl(row.storage_path, SIGNED_READ_SECONDS)");
    expect(body).toContain('audit(ctx, "documents.read"');
  });

  it("grants only a grantable pair, names the registered provider's recipient, and lands every grant in the ISO ledger", () => {
    const grant = fnBody("actConsentsGrant");
    expect(grant).toContain("isGrantable(purpose, recipient)");
    expect(grant).toContain("RECIPIENT_FOR_PROVIDER[providerId] !== recipient");
    expect(grant).toContain("CONSENT_TERMS_VERSIONS[purpose]");
    expect(grant).toContain('ledgerConsent(ctx, purpose, categories, "granted"');
    expect(grant).toContain("jurisdictionOf(ctx)");
    expect(fnBody("actConsentsRevoke")).toMatch(/"withdrawn"/);
  });

  it("confirm is gated on the AI flag and the storage consent; reject and candidates sit above both", () => {
    const confirm = fnBody("actRecordsConfirm");
    const flag = confirm.indexOf('ctx.flags["health.ai.enabled"]');
    const consent = confirm.indexOf('requireConsent(ctx, "store_records"');
    const validate = confirm.indexOf("validateRecordInput(");
    const update = confirm.indexOf('.update({ status: "active"');
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(consent);
    expect(validate).toBeLessThan(update);
    expect(consent).toBeLessThan(update);
    expect(confirm).toContain('.eq("status", "candidate")');
    expect(confirm).toContain('verifiedBy: "user"');
    for (const name of ["actRecordsReject", "actRecordsCandidates"]) {
      const body = fnBody(name);
      expect(body, name).not.toContain("health.ai.enabled");
      expect(body, name).not.toContain("requireConsent(");
    }
    expect(fnBody("actRecordsReject")).toContain('status: "rejected", deleted_at: ctx.now');
  });

  it("purge refuses under a legal hold and MARKS receipts rather than deleting them", () => {
    const purge = fnBody("actPurge");
    const hold = purge.indexOf('rpc("has_active_legal_hold"');
    const first = purge.indexOf(".update(");
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(first);
    expect(purge).toContain('reason: "legal_hold"');
    expect(purge).toContain("purged_at: ctx.now, manifest: {}");
    expect(purge).not.toMatch(/health_ai_requests"\)\s*\.delete\(/);
  });

  it("export carries the receipts, so a person can see what AI was asked about them", () => {
    expect(fnBody("actExport")).toContain('.from("health_ai_requests")');
    expect(fnBody("actExport")).toContain("aiRequests:");
  });

  it("uses the body-first json() convention throughout", () => {
    expect(SRC).toMatch(/function json\(body: unknown, status = 200\)/);
    expect(SRC).not.toMatch(/json\(\s*\d{3}\s*,/);
  });
});

describe("the adapter seam", () => {
  it("is the null adapter in Phase 1 and every call resolves ok", async () => {
    const a = adapterFor(allHealthFlagsOff());
    expect(a).toBeInstanceOf(NullAdapter);
    expect(a.name).toBe("null");
    await expect(a.deleteRecord("x", "u")).resolves.toEqual({ ok: true });
    await expect(a.deleteDocumentReference("x", "u")).resolves.toEqual({ ok: true });
  });

  it("the function goes through adapterFor, not a hard-wired adapter", () => {
    expect(SRC).toMatch(/adapterFor\(ctx\.flags\)/);
    expect(SRC).not.toMatch(/new NullAdapter|GoogleFhirAdapter/);
  });
});

describe("the audit call shape", () => {
  it("passes every field the SQL function takes, with the detail whitelisted", () => {
    const args = auditRpcArgs({
      userId: "u",
      actor: "u",
      action: "records.create",
      objectType: "record",
      objectId: "r",
      requestId: "q",
      outcome: "ok",
      detail: { kind: "lab", valueText: "HbA1c 7.9" },
    });
    expect(Object.keys(args).sort()).toEqual(
      [
        "_action",
        "_actor",
        "_consent_id",
        "_detail",
        "_object_id",
        "_object_type",
        "_outcome",
        "_purpose",
        "_request_id",
        "_user_id",
      ].sort(),
    );
    expect(args._detail).toEqual({ kind: "lab" });
    expect(JSON.stringify(args)).not.toContain("HbA1c");
  });
});
