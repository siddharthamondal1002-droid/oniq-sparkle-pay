/**
 * Play and copyright safety, pinned in source: the library never downloads,
 * proxies, scrapes or extracts; it plays through the shared player or opens
 * the provider's page; its AI answer is labelled; its lookups are declared;
 * its screen is gated like Watch and keeps every hook above the gate.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_SURFACES, NATIVE_CAPABILITIES, THIRD_PARTY_REQUESTS } from "@/config/playCompliance";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(p)) out.push(p);
  }
  return out;
}

function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const LIB_FILES = [
  ...walk(join(ROOT, "src/lib/watch")).filter((p) => !p.includes("__tests__")),
  ...walk(join(ROOT, "src/components/watch/library")),
  join(ROOT, "src/routes/_authenticated/app.watch_.library.tsx"),
];
const FUNCTIONS = [
  "supabase/functions/watch-resolve/index.ts",
  "supabase/functions/watch-ask/index.ts",
].map((p) => join(ROOT, p));

describe("nothing downloads, proxies, scrapes or extracts", () => {
  it("no library or function file names a stream, a download, a manifest or a transcript endpoint", () => {
    const bad =
      /m3u8|videoplayback|googlevideo|hlsManifest|get_video_info|player_response|timedtext|ytdl|yt-dlp|youtube-dl|\.mp4\?|download=|\bdownload\(/i;
    for (const p of [...LIB_FILES, ...FUNCTIONS]) {
      expect(codeOf(p), p.slice(ROOT.length + 1)).not.toMatch(bad);
    }
  });

  it("the resolver reaches only the providers' metadata endpoints, with a timeout", () => {
    const src = codeOf(FUNCTIONS[0]);
    const hosts = [...src.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]);
    for (const h of new Set(hosts)) {
      expect(
        [
          "www.youtube.com",
          "vimeo.com",
          "api.dailymotion.com",
          "archive.org",
          "oniqhub.com",
          "esm.sh",
        ],
        `unexpected host ${h}`,
      ).toContain(h);
    }
    expect(src).toContain("fetchWithTimeout(");
    expect(src).toContain("/oembed");
    expect(src).toContain("archive.org/metadata/");
    expect(src).not.toMatch(/user-agent.*Chrome\//i);
  });

  it("the resolver and the asker require a signed-in user and never log content", () => {
    for (const p of FUNCTIONS) {
      const src = codeOf(p);
      expect(src).toContain('json(401, { error: "unauthorized" })');
      expect(src).toContain("supabase.auth.getUser(token)");
      expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*(notes|question|answer)/);
    }
  });

  it("the asker answers from the person's notes only, says so, and reads through row-level security", () => {
    const src = readFileSync(FUNCTIONS[1], "utf8");
    expect(src).toContain("You have NOT seen any of these videos and have no transcript");
    expect(src).toContain("Never invent quotes, timestamps, facts");
    expect(src).toContain('.from("watch_items")');
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("the provider layer never fetches", () => {
    const src = codeOf(join(ROOT, "src/lib/watch/providers.ts"));
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/XMLHttpRequest|axios/);
  });

  it("Nebula is link-out only and TikTok is absent", () => {
    const src = readFileSync(join(ROOT, "src/lib/watch/providers.ts"), "utf8");
    expect(src).toContain(
      'capabilities: { embed: false, resume: false, progress: false, rights: false, metadata: "none" }',
    );
    for (const p of LIB_FILES) expect(readFileSync(p, "utf8")).not.toMatch(/tiktok/i);
  });
});

describe("playback stays the provider's own", () => {
  it("the library screens use the shared player and build no frame or video element of their own", () => {
    for (const p of LIB_FILES.filter((f) => f.endsWith(".tsx"))) {
      const src = codeOf(p);
      expect(src, p).not.toMatch(/<iframe|<video|new Audio\(/);
    }
    expect(codeOf(join(ROOT, "src/components/watch/library/ItemSheet.tsx"))).toContain(
      "<WatchPlayer",
    );
    expect(codeOf(join(ROOT, "src/components/watch/library/ItemSheet.tsx"))).toContain(
      "openInApp(item.canonical_url)",
    );
  });

  it("no card fetches artwork from a provider", () => {
    for (const p of LIB_FILES.filter((f) => f.endsWith(".tsx"))) {
      expect(codeOf(p), p).not.toMatch(/<img\b|ytimg\.com|vumbnail|i\.vimeocdn/);
    }
  });
});

describe("the screen", () => {
  const page = readFileSync(join(ROOT, "src/components/watch/library/WatchLibrary.tsx"), "utf8");
  const route = readFileSync(
    join(ROOT, "src/routes/_authenticated/app.watch_.library.tsx"),
    "utf8",
  );

  it("is registered off the Watch leaf, at /app/watch/library", () => {
    expect(route).toContain('createFileRoute("/_authenticated/app/watch_/library")');
    expect(readFileSync(join(ROOT, "src/routeTree.gen.ts"), "utf8")).toContain(
      "'/app/watch/library'",
    );
  });

  it("is gated like Watch and keeps every hook above the gate", () => {
    expect(page).toContain('isAvailable("watch", home)');
    const gate = page.indexOf('if (!isAvailable("watch", home))');
    const after = page.slice(gate);
    expect(gate).toBeGreaterThan(0);
    expect(after, "a hook after the early return").not.toMatch(/\buse[A-Z]\w*\(/);
  });

  it("offers every surface in one row, and search over the person's own library", () => {
    for (const s of [
      "Continue",
      "Inbox",
      "Resurface",
      "Following",
      "Collections",
      "Threads",
      "Movies",
    ]) {
      expect(page).toContain(`label: "${s}"`);
    }
    expect(page).toContain('role="tablist"');
    expect(page).toContain('data-testid="watch-library-search"');
    expect(page).toContain("NOT_AFFILIATED_NOTICE");
    expect(page).toContain("WATCH_NOTICE");
  });

  it("has loading, empty and error states, confirms removal, and paginates", () => {
    const panels = readFileSync(join(ROOT, "src/components/watch/library/panels.tsx"), "utf8");
    expect(panels).toContain("<LoadingRows");
    expect(panels).toContain("<EmptyState");
    expect(panels).toContain("<ErrorState");
    expect(panels).toContain("fetchNextPage");
    expect(page).toContain('role="alertdialog"');
    const lib = readFileSync(join(ROOT, "src/lib/watch/library.ts"), "utf8");
    expect(lib).toContain("PAGE_SIZE = 40");
    expect(lib).toContain(".limit(limit + 1)");
  });

  it("labels the AI answer and is declared as an AI surface", () => {
    const sheet = readFileSync(join(ROOT, "src/components/watch/library/ItemSheet.tsx"), "utf8");
    expect(sheet).toContain("AI_OUTPUT_LABEL");
    expect(sheet).toMatch(/<AiOutputReport\s+surface="watch_ai_output"/);
    expect(
      AI_SURFACES.some(
        (s) =>
          s.id === "watch_ai_output" && s.file === "src/components/watch/library/ItemSheet.tsx",
      ),
    ).toBe(true);
  });

  it("declares the server-side lookups and counts the library as native work", () => {
    const hosts = THIRD_PARTY_REQUESTS.map((r) => r.host);
    for (const h of ["vimeo.com", "api.dailymotion.com", "archive.org"]) expect(hosts).toContain(h);
    expect(NATIVE_CAPABILITIES.some((c) => c.startsWith("Watch library:"))).toBe(true);
  });

  it("says nothing a Play reviewer would read as infringement", () => {
    for (const p of LIB_FILES) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(
        /download any video|watch anything for free|free movies from anywhere|access paid content/i,
      );
    }
  });
});
