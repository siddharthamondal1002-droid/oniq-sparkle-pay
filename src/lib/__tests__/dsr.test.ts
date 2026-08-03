import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DSR_SLA_DAYS,
  DSR_TYPES,
  canCancel,
  countdown,
  erasureEffectiveAt,
  slaDeadline,
} from "@/lib/dsr";

const DAY = 24 * 60 * 60 * 1000;
const created = "2026-08-03T12:00:00.000Z";

describe("DSR service levels", () => {
  it("is exactly 30 days and identical across all four request types", () => {
    const deadlines = DSR_TYPES.map(() => slaDeadline(created).toISOString());
    expect(new Set(deadlines).size).toBe(1);
    expect(DSR_SLA_DAYS).toBe(30);
    expect(slaDeadline(created).getTime() - new Date(created).getTime()).toBe(30 * DAY);
  });

  it("puts erasure's effective-at exactly 48 hours after creation", () => {
    const eff = erasureEffectiveAt("erasure", created)!;
    expect(eff.getTime() - new Date(created).getTime()).toBe(48 * 60 * 60 * 1000);
    expect(eff.toISOString()).toBe("2026-08-05T12:00:00.000Z");
  });

  it("has no effective-at for non-erasure types", () => {
    for (const t of ["access", "correction", "portability"] as const) {
      expect(erasureEffectiveAt(t, created)).toBeNull();
    }
  });
});

describe("cancellation window", () => {
  const erasure = {
    status: "received" as const,
    request_type: "erasure" as const,
    erasure_effective_at: "2026-08-05T12:00:00.000Z",
  };

  it("allows cancelling before the 48-hour window closes", () => {
    expect(canCancel(erasure, new Date("2026-08-05T11:59:00.000Z"))).toBe(true);
  });

  it("blocks cancelling once the effective-at has passed", () => {
    expect(canCancel(erasure, new Date("2026-08-05T12:00:01.000Z"))).toBe(false);
  });

  it("blocks cancelling anything that is no longer 'received'", () => {
    expect(
      canCancel({ ...erasure, status: "soft_deleted" }, new Date("2026-08-04T00:00:00.000Z")),
    ).toBe(false);
    expect(
      canCancel(
        { status: "completed", request_type: "access", erasure_effective_at: null },
        new Date(created),
      ),
    ).toBe(false);
  });

  it("allows cancelling a pending non-erasure ticket at any time", () => {
    expect(
      canCancel(
        { status: "received", request_type: "correction", erasure_effective_at: null },
        new Date("2027-01-01T00:00:00.000Z"),
      ),
    ).toBe(true);
  });
});

describe("countdown", () => {
  it("formats the remaining window and returns null once elapsed", () => {
    expect(countdown("2026-08-05T12:00:00.000Z", new Date("2026-08-04T10:30:00.000Z"))).toBe(
      "1d 1h 30m",
    );
    expect(countdown("2026-08-05T12:00:00.000Z", new Date("2026-08-06T00:00:00.000Z"))).toBeNull();
  });
});

describe("dsr_requests migration source scan", () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .filter((s) => s.includes("public.dsr_requests"))
    .join("\n");

  it("finds the dsr_requests migration", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.dsr_requests");
  });

  it("grants authenticated SELECT only — no client write grants", () => {
    expect(sql).toContain("GRANT SELECT ON public.dsr_requests TO authenticated");
    expect(sql).not.toMatch(/GRANT[^;]*INSERT[^;]*ON public\.dsr_requests[^;]*authenticated/i);
    expect(sql).not.toMatch(/GRANT[^;]*UPDATE[^;]*ON public\.dsr_requests[^;]*authenticated/i);
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*ON public\.dsr_requests[^;]*authenticated/i);
  });

  it("declares no client-facing INSERT/UPDATE/DELETE policy", () => {
    const policies = sql.match(/CREATE POLICY[\s\S]*?;/gi) ?? [];
    const clientWrite = policies.filter(
      (p) => /FOR\s+(INSERT|UPDATE|DELETE|ALL)/i.test(p) && /TO\s+authenticated/i.test(p),
    );
    expect(clientWrite).toEqual([]);
  });

  it("keeps the single 30-day SLA and the 48-hour erasure notice in SQL", () => {
    expect(sql).toContain("created_at + interval '30 days'");
    expect(sql).toContain("created_at + interval '48 hours'");
    expect(sql).toContain("soft_deleted_at + interval '30 days'");
  });
});
