/**
 * THE SCREENS OBEY THE MODULE'S RULES: they talk only through healthApi,
 * fire no query while the flag is off, never read a file whole, keep every
 * hook above every early return, and speak through the overlay.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const ROUTES = join(__dirname, "..", "..", "routes", "_authenticated");
const FILES = {
  layout: "app.health.tsx",
  timeline: "app.health.index.tsx",
  records: "app.health.records.tsx",
  consent: "app.health.consent.tsx",
} as const;
const read = (f: string) => stripComments(readFileSync(join(ROUTES, f), "utf8"));

describe("every health screen", () => {
  it.each(Object.values(FILES))("%s reads no table directly", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/supabase\s*\.from\(/);
    expect(src).not.toMatch(/\.from\("health_/);
    expect(src).not.toMatch(/\.rpc\(/);
  });

  it.each([FILES.timeline, FILES.records, FILES.consent])(
    "%s goes through healthApi and useT",
    (f) => {
      const src = read(f);
      expect(src).toMatch(/healthApi(<[^>]+>)?\(/);
      expect(src).toContain("useT()");
      expect(src).toContain("reasonText(t,");
    },
  );

  it.each([FILES.timeline, FILES.records, FILES.consent])(
    "%s fires no query while its flag is off",
    (f) => {
      const src = read(f);
      expect(src).toMatch(/enabled: HEALTH_(UPLOADS_)?ENABLED/);
    },
  );

  it("the layout registers the three-language overlay and gates on the flag", () => {
    const src = read(FILES.layout);
    expect(src).toContain("registerHealthTranslations()");
    expect(src).toContain("if (!HEALTH_ENABLED)");
    expect(src).toMatch(/<Outlet\b/);
  });
});

describe("the documents screen", () => {
  const src = read(FILES.records);

  it("never reads the file whole", () => {
    expect(src).not.toMatch(/\.arrayBuffer\(\)/);
    expect(src).not.toMatch(/readAsDataURL|readAsArrayBuffer|readAsBinaryString/);
    expect(src).not.toMatch(/\.text\(\)/);
  });

  it("sniffs the head, uploads by signed token, then confirms", () => {
    expect(src).toContain("sniffDocumentMime(");
    expect(src).toContain("uploadToSignedUrl(");
    const register = src.indexOf('"documents.register"');
    const upload = src.indexOf("uploadToSignedUrl(");
    const confirm = src.indexOf('"documents.confirm"');
    expect(register).toBeLessThan(upload);
    expect(upload).toBeLessThan(confirm);
  });

  it("keeps every hook above the uploads-off early return", () => {
    const gate = src.indexOf("if (!HEALTH_UPLOADS_ENABLED)");
    expect(gate).toBeGreaterThan(0);
    for (const hook of [
      "useT(",
      "useQueryClient(",
      "useRef",
      "useState",
      "useQuery(",
      "useMutation(",
    ]) {
      const last = src.lastIndexOf(hook);
      expect(last, hook).toBeGreaterThan(-1);
      expect(last, `${hook} sits below the early return`).toBeLessThan(gate);
    }
  });
});

describe("the consent screen", () => {
  it("offers storage and AI-by-ONIQ, both to ONIQ, and shows the rest as later", () => {
    const src = read(FILES.consent);
    expect(src).toContain('grant.mutate("store_records")');
    expect(src).toContain('grant.mutate("ai_interpretation")');
    expect(src).toContain('recipient: "oniq"');
    expect(src).not.toMatch(/google_vertex|clinician|abdm/);
    expect(src).toContain("GRANTABLE_PURPOSES");
    expect(src).toContain("health.consent.later");
    // Purge is two taps, never one.
    expect(src).toMatch(/purgeArmed \? purge\.mutate\(\) : setPurgeArmed\(true\)/);
  });
});
