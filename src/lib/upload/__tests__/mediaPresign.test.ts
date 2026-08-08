/**
 * The presign function's safety properties.
 *
 * Source assertions, and only because the alternative is worse: this function
 * cannot execute here (Deno, plus it needs live R2 credentials). Every check
 * below is one where a later edit would open a real hole that tsc would not
 * notice.
 *
 * The behavioural half — that the credentials actually work — is deliberately
 * NOT faked. It is the `check` action, run once against the real bucket.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import {
  MEDIA_SECRET_NAMES,
  R2_SIGNING_REGION,
  MAX_UPLOAD_BYTES,
  r2Endpoint,
} from "@/config/mediaStorage";

const ROOT = process.cwd();
const FN = "supabase/functions/media-presign/index.ts";
const src = readFileSync(join(ROOT, FN), "utf8");
const code = stripComments(src);

describe("secret names are pinned in one place", () => {
  it("the function reads exactly the names the config documents", () => {
    // Two places naming the same secret differently is a silent
    // "not configured" that costs an afternoon.
    for (const name of Object.values(MEDIA_SECRET_NAMES)) {
      expect(code, `function never reads ${name}`).toContain(name);
    }
  });

  it("no secret is exposed to the client bundle", () => {
    // A VITE_ prefix would put an R2 key in every user's phone, and rotating
    // it would break every install until they updated.
    for (const name of Object.values(MEDIA_SECRET_NAMES)) {
      expect(name).not.toMatch(/^VITE_/);
    }
    const clientSrc = readFileSync(join(ROOT, "src/config/mediaStorage.ts"), "utf8");
    expect(clientSrc).not.toMatch(/R2_SECRET_ACCESS_KEY\s*[:=]\s*["'][^"']+["']/);
  });

  it("signs with 'auto', not the bucket location", () => {
    // R2's SigV4 region is the literal string "auto". Signing with the bucket
    // location returns a 403 that reads exactly like a bad key, which is the
    // single most misleading failure on this path.
    expect(R2_SIGNING_REGION).toBe("auto");
    expect(code).toMatch(/SIGNING_REGION = "auto"/);
  });

  it("derives the endpoint from the account id the same way both sides do", () => {
    expect(r2Endpoint("abc123")).toBe("https://abc123.r2.cloudflarestorage.com");
    expect(code).toContain(".r2.cloudflarestorage.com");
  });
});

describe("the size cap is enforced server-side, not just asked nicely", () => {
  it("rejects an oversized upload at create", () => {
    // The client check is a courtesy so the user hears immediately. Anything
    // that can call this endpoint can lie about a size, so this is the control.
    expect(code).toMatch(/size > MAX_UPLOAD_BYTES/);
    expect(code).toMatch(/413/);
  });

  it("uses the same cap the client does", () => {
    // Two different caps would reject a file the user was told was fine,
    // which reads as a bug rather than a limit.
    expect(MAX_UPLOAD_BYTES).toBe(200 * 1024 * 1024);
    expect(code).toContain("const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;");
    expect(code).toContain("const UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;");
  });

  it("computes the part plan itself rather than accepting one", () => {
    // Taking a caller's part plan would let them presign arbitrary ranges.
    expect(code).toMatch(/function planParts\(/);
    expect(code).not.toMatch(/body\?\.parts\s*\|\|\s*planParts|body\.plan/);
  });
});

describe("one account cannot touch another's upload", () => {
  it("namespaces object keys by user", () => {
    expect(code).toMatch(/u\/\$\{userId\}\//);
  });

  it("refuses to complete or abort outside the caller's own prefix", () => {
    // Without this, knowing an uploadId would let anyone finish or destroy
    // someone else's in-flight upload.
    expect(code).toMatch(/key\.startsWith\(`u\/\$\{userId\}\/`\)/);
    expect(code).toMatch(/not your upload/);
  });

  it("requires auth before doing anything at all", () => {
    expect(code).toMatch(/auth\.getUser\(/);
    const authAt = code.indexOf("auth.getUser(");
    const actionAt = code.indexOf("const action =");
    expect(authAt).toBeGreaterThan(-1);
    expect(authAt, "the action is read before the caller is identified").toBeLessThan(actionAt);
  });
});

describe("bytes never pass through the function", () => {
  it("presigns instead of proxying", () => {
    // Proxying 200 MB through an edge function would buffer it, time out, and
    // pay egress twice.
    expect(code).toMatch(/signQuery: true/);
    expect(code).not.toMatch(/await req\.arrayBuffer\(\)|await req\.blob\(\)/);
  });

  it("keeps read URLs short-lived", () => {
    // A long-lived signed URL forwarded out of the app is an unrevocable
    // public link to someone's private media.
    expect(code).toMatch(/SIGNED_URL_TTL_SECONDS = 300/);
  });
});

describe("a misconfiguration says what is wrong", () => {
  it("names the missing secrets rather than saying 'not configured'", () => {
    // None of these names is itself a secret, and a bare "not configured"
    // sends someone hunting through four possibilities.
    expect(code).toMatch(/missing secrets: /);
  });

  it("offers the region hint on a 403, which is the usual cause", () => {
    expect(src).toMatch(/signing region is 'auto'/);
  });

  it("has a check action so credentials can be proven without an upload", () => {
    expect(code).toMatch(/action === "check"/);
  });
});

describe("the operator shortcut is limited to check", () => {
  it("lets the service role run check without a signed-in user", () => {
    // Verifying keys should not require signing in as a real person and
    // uploading a real file. That errand is how a broken key gets found by a
    // user rather than by us.
    expect(code).toMatch(/isOperator/);
    expect(code).toMatch(/token === serviceKey/);
  });

  it("refuses to compare against an empty or absent service key", () => {
    // Without the length guard, an unset SUPABASE_SERVICE_ROLE_KEY makes
    // serviceKey "" — and a caller sending "Bearer " would match it and be
    // promoted to operator. That is the whole bug in one line.
    expect(code).toMatch(/serviceKey\.length > 20 && token === serviceKey/);
  });

  it("blocks every other action without a real user", () => {
    // The operator may list one object. It may not create, complete, abort or
    // read anything, because all of those act on a specific user's prefix.
    expect(code).toMatch(/if \(!userId\) return json\(403/);
    const gate = code.indexOf("if (!userId) return json(403");
    for (const later of ['action === "create"', 'action === "complete"', 'action === "get"']) {
      expect(code.indexOf(later), `${later} is reachable without a user`).toBeGreaterThan(gate);
    }
    // ...and check is deliberately BEFORE the gate.
    expect(code.indexOf('action === "check"')).toBeLessThan(gate);
  });
});
