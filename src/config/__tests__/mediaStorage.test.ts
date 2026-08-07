/**
 * A4's constraints, pinned before A4 exists.
 *
 * The implementation is three steps away in the build order. These assert the
 * decisions so that whoever writes the upload path — including me, later,
 * having forgotten — finds them enforced rather than having to rediscover the
 * reasoning from a chat log.
 *
 * Verification item 10 asks that 201 MB is rejected client-side AND at
 * presign, that URLs are signed, that there is no public bucket, that expiry
 * runs, and that deleting a message removes its media. What can be checked
 * before the code exists is checked here; the rest is checked at A4.
 */
import { describe, expect, it } from "vitest";
import {
  BLOCKED_MAGIC_BYTES,
  BANNED_WHOLE_FILE_READS,
  MAX_UPLOAD_BYTES,
  MEDIA_BUCKET,
  MEDIA_RETENTION_DAYS,
  MEDIA_SAFETY,
  SIGNED_URL_TTL_SECONDS,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_RESUME,
  formatBytes,
  withinUploadCap,
} from "@/config/mediaStorage";

describe("the cap is 200 MB and it is exact", () => {
  it("is 200 MB in bytes, not 200,000,000", () => {
    // A cap stated in MB and implemented in decimal megabytes rejects files a
    // user was told were fine, which reads as a bug rather than a limit.
    expect(MAX_UPLOAD_BYTES).toBe(209_715_200);
  });

  it("accepts 200 MB exactly and rejects a byte more", () => {
    expect(withinUploadCap(MAX_UPLOAD_BYTES)).toBe(true);
    expect(withinUploadCap(MAX_UPLOAD_BYTES + 1)).toBe(false);
  });

  it("rejects 201 MB, which is verification item 10's number", () => {
    expect(withinUploadCap(201 * 1024 * 1024)).toBe(false);
  });

  it("rejects empty, negative and non-finite sizes", () => {
    // A zero-byte file is not a share, and NaN must never pass a cap check.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(withinUploadCap(bad), String(bad)).toBe(false);
    }
  });

  it("chunks at 5 MB, S3's minimum for a non-final part", () => {
    expect(UPLOAD_CHUNK_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_UPLOAD_BYTES % UPLOAD_CHUNK_BYTES).toBe(0);
  });

  it("formats a size the way a rejection message needs to read", () => {
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("200 MB");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

describe("the bucket is private and its region was a decision", () => {
  it("is never public — signed URLs only", () => {
    expect(MEDIA_BUCKET.publicAccess).toBe(false);
  });

  it("signs reads for minutes, not days", () => {
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(900);
    expect(SIGNED_URL_TTL_SECONDS).toBeGreaterThan(0);
  });

  it("records the region and why it was accepted rather than changed", () => {
    // R2's region is immutable after creation. If this is ever read as an
    // oversight, someone will "fix" it with a migration nobody needed — so
    // the reasoning is stored next to the value.
    expect(MEDIA_BUCKET.region).toBe("ENAM");
    expect(MEDIA_BUCKET.regionDecidedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(MEDIA_BUCKET.regionDecision).toMatch(/immutable/i);
    expect(MEDIA_BUCKET.regionDecision.length).toBeGreaterThan(60);
  });

  it("names R2 specifically, since zero egress is the whole argument", () => {
    expect(MEDIA_BUCKET.provider).toMatch(/R2/);
  });

  it("expires files rather than becoming an archive", () => {
    expect(MEDIA_RETENTION_DAYS.min).toBeGreaterThanOrEqual(30);
    expect(MEDIA_RETENTION_DAYS.max).toBeLessThanOrEqual(90);
    expect(MEDIA_RETENTION_DAYS.min).toBeLessThan(MEDIA_RETENTION_DAYS.max);
  });
});

describe("resumability is mandatory, at chunk granularity", () => {
  it("requires resume, not restart", () => {
    // A 200 MB upload on Indian mobile data WILL be interrupted. Restarting
    // from zero means it never finishes, so the feature would not work at all
    // rather than working slowly.
    expect(UPLOAD_RESUME.required).toBe(true);
    expect(UPLOAD_RESUME.retryGranularity).toBe("chunk");
  });

  it("requires idempotent chunk writes", () => {
    // Without this a retried chunk can land twice and corrupt the object.
    expect(UPLOAD_RESUME.idempotentChunks).toBe(true);
  });

  it("survives backgrounding and a network switch", () => {
    expect(UPLOAD_RESUME.persistAcrossBackgrounding).toBe(true);
    expect(UPLOAD_RESUME.surviveNetworkSwitch).toBe(true);
  });
});

describe("executables are blocked by signature, never by extension", () => {
  it("lists leading bytes, not file extensions", () => {
    // Renaming payload.exe to holiday.jpg defeats an extension check
    // completely — and an extension check is worse than none, because it
    // looks like protection.
    expect(BLOCKED_MAGIC_BYTES.length).toBeGreaterThanOrEqual(6);
    for (const b of BLOCKED_MAGIC_BYTES) {
      expect(b.hex, b.label).toMatch(/^[0-9A-F]+$/);
      expect(b.label.length).toBeGreaterThan(3);
    }
  });

  it("covers the platforms that actually matter here", () => {
    const hexes = BLOCKED_MAGIC_BYTES.map((b) => b.hex);
    expect(hexes).toContain("4D5A"); // Windows PE
    expect(hexes).toContain("7F454C46"); // ELF
    expect(hexes).toContain("504B0304"); // APK/JAR/ZIP — the Android one
    expect(hexes).toContain("2321"); // shebang
  });

  it("names no extension anywhere in the block list", () => {
    const blob = JSON.stringify(BLOCKED_MAGIC_BYTES);
    for (const ext of [".exe", ".apk", ".sh", ".bat", ".jar"]) {
      expect(blob, `blocking by extension: ${ext}`).not.toContain(ext);
    }
  });
});

describe("safety ships before file sharing does", () => {
  it("requires the reporting path to work first", () => {
    // Chat is not E2EE by design, so ONIQ can see what it stores. A service
    // that can see its content and offers no way to report it has chosen the
    // worst of both.
    expect(MEDIA_SAFETY.reportingPathRequiredBeforeLaunch).toBe(true);
    expect(MEDIA_SAFETY.blockOnMedia).toBe(true);
  });

  it("deletes bytes with the message, not just the row", () => {
    expect(MEDIA_SAFETY.deleteMessageDeletesMedia).toBe(true);
  });

  it("caps per user, so one account cannot fill the bucket", () => {
    expect(MEDIA_SAFETY.perUserRateCap).toBe(true);
  });
});

describe("the whole-file-read ban is recorded, not only commented", () => {
  it("names all five banned calls", () => {
    expect(BANNED_WHOLE_FILE_READS).toHaveLength(5);
    const blob = BANNED_WHOLE_FILE_READS.join(" ");
    for (const m of [
      "readAsArrayBuffer",
      "readAsDataURL",
      "readAsBinaryString",
      "arrayBuffer",
      "text",
    ]) {
      expect(blob).toContain(m);
    }
  });
});
