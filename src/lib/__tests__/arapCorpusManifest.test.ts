/**
 * Step 11C — the owner-authorised corpus manifest, the runner-side fetcher,
 * and the driver-output path the CI run takes through the decision CLI.
 *
 * The manifest is the owner's statement of scope. These tests pin that it
 * names exactly the 18 owner stills by derived key, nobody else's, under an
 * owner-only grant — and that the CLI, given driver output plus that
 * manifest, cross-checks hashes, classifies a listed-but-absent still as
 * MISSING, and never lets an unlisted or foreign record in.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const MANIFEST =
  "remotion/fixtures/arap-eligibility/corpus/OWNER_AUTHORIZED_GATEWAY_CORPUS.manifest.json";
const OWNER_PREFIX = "d3b58345";
const OTHER_PREFIX = "bb483798";
const JOBS = ["87c2b756-a832-48dc-b97b-7a3235ddee5c", "64874747-44af-4086-a58a-250d2e7eec08"];

type Manifest = {
  schema: string;
  population: string;
  corpusId: string;
  label: string;
  readBase: string;
  authorization: { scope: string; ownerUserId: string; grantedBy: string; grantedAt: string };
  stills: Record<
    string,
    { ownerUserId: string; jobId: string; sceneId: string; shotId: string; sha256?: string }
  >;
};

describe("OWNER_AUTHORIZED_GATEWAY_CORPUS manifest", () => {
  const m = JSON.parse(read(MANIFEST)) as Manifest;
  const stems = Object.keys(m.stills).sort();

  it("is a gateway corpus under an owner-only grant, named so it cannot be mistaken", () => {
    expect(m.schema).toBe("oniq.arap-corpus-manifest/1");
    expect(m.population).toBe("gateway");
    expect(m.corpusId).toBe("OWNER_AUTHORIZED_GATEWAY_CORPUS");
    expect(m.label).toBe("OWNER_AUTHORIZED_GATEWAY_CORPUS");
    expect(m.authorization).toMatchObject({
      scope: "owner-only",
      grantedBy: "owner",
      grantedAt: "2026-09-02",
    });
    expect(m.authorization.ownerUserId.startsWith(OWNER_PREFIX)).toBe(true);
  });
  it("lists exactly the 18 derived keys of the two owner films, and nothing else", () => {
    const expected = JOBS.flatMap((job) =>
      Array.from({ length: 9 }, (_, i) => `${job}-s-shot${String(i).padStart(3, "0")}`),
    ).sort();
    expect(stems).toEqual(expected);
    for (const [stem, s] of Object.entries(m.stills)) {
      expect(s.ownerUserId).toBe(m.authorization.ownerUserId);
      expect(stem).toBe(`${s.jobId}-${s.sceneId}-${s.shotId}`);
      expect(s.sceneId).toBe("s");
      expect(s.shotId).toMatch(/^shot\d{3}$/);
      if (s.sha256 !== undefined) expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("cannot include the other user's stills: no foreign id anywhere in the file", () => {
    expect(read(MANIFEST)).not.toContain(OTHER_PREFIX);
  });
  it("reads from a bare https origin, never a presigned or credentialed URL", () => {
    expect(m.readBase).toMatch(/^https:\/\/[a-z0-9.-]+$/);
    expect(m.readBase).not.toContain("?");
    expect(m.readBase).not.toContain("@");
  });
});

describe("the runner-side fetcher", () => {
  it("passes its own network-free self-test", () => {
    const out = execFileSync(
      "python3",
      ["runtime/arap-cpu/measure/fetch_corpus.py", "--selftest"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(out).toContain("SELFTEST: ok");
  });
  it("only ever requests listed stems, refuses a bad base, and stops on a hash mismatch (read as data)", () => {
    const src = read("runtime/arap-cpu/measure/fetch_corpus.py");
    expect(src).toContain("for stem in sorted(stills)");
    expect(src).toContain("sha256 mismatch");
    expect(src).toContain("readBase must be https");
    expect(src).toContain("corpus dir is not empty");
    expect(src).toContain('entry["missing"] = "HTTP 404 at the derived key"');
  });
});

describe("the workflow's manifest mode is read as data", () => {
  const wf = read(".github/workflows/arap-eligibility-measure.yml");
  const code = wf
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  it("fetches only when a committed manifest is named, self-tests the fetcher first, and can still do nothing else", () => {
    expect(code).toContain('if [ -n "${CORPUS_MANIFEST}" ]');
    expect(code).toContain("fetch_corpus.py --selftest");
    expect(code).toContain('fetch_corpus.py "${CORPUS_MANIFEST}" corpus');
    expect(code).not.toContain("docker push");
    expect(code).not.toContain("docker build");
    expect(code).not.toContain("allowPoseWarp");
    expect(code).not.toMatch(/\brender\b/);
    expect(code).toContain("packages: read");
    expect(code).not.toContain("packages: write");
  });
});

describe("the CLI on driver output plus a corpus manifest — the path the CI run takes", () => {
  const script = "scripts/arap-real-corpus-decision.ts";
  const record = JSON.parse(read("remotion/fixtures/arap-eligibility/synthetic-record.json"));
  const run = (...args: string[]) =>
    execFileSync("npx", ["tsx", script, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 180_000,
    });

  function driverOut(dir: string, stills: { stem: string; sha: string }[]) {
    mkdirSync(join(dir, "records"), { recursive: true });
    for (const s of stills) {
      const r = JSON.parse(JSON.stringify(record));
      r.still_id = s.stem;
      r.source_file = `${s.stem}.png`;
      r.source_sha256 = s.sha;
      r.corpus_id = "OWNER_AUTHORIZED_GATEWAY_CORPUS";
      writeFileSync(join(dir, "records", `${s.stem}-00.json`), JSON.stringify(r));
    }
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        corpus_id: "OWNER_AUTHORIZED_GATEWAY_CORPUS",
        measured_at_unix: 1_756_800_000,
        instrument: "runtime/arap-cpu/measure/measure_eligibility.py",
        stills: stills.map((s) => ({
          still_id: s.stem,
          file: `${s.stem}.png`,
          sha256: s.sha,
          candidates: 1,
        })),
        record_files: stills.map((s) => `${s.stem}-00.json`),
      }),
    );
  }

  it("cross-checks hashes, counts a listed-but-absent still as MISSING, and ends in one state", () => {
    const dir = mkdtempSync(join(tmpdir(), "arap-11c-"));
    const owner = "d3b58345-owner-0000-0000-000000000000";
    const stems = Array.from({ length: 7 }, (_, i) => `job-s-shot00${i}`);
    const sha = (i: number) => String(i).repeat(64).slice(0, 64);
    // six measured, one whose bytes disagree with the manifest, one listed but never seen
    driverOut(
      join(dir, "out"),
      stems.map((stem, i) => ({ stem, sha: sha(i) })),
    );
    const manifestStills: Record<string, unknown> = {};
    stems.forEach((stem, i) => {
      manifestStills[stem] = {
        ownerUserId: owner,
        jobId: "job",
        sceneId: "s",
        shotId: `shot00${i}`,
        sha256: i === 6 ? sha(9) : sha(i),
      };
    });
    manifestStills["job-s-shot007"] = {
      ownerUserId: owner,
      jobId: "job",
      sceneId: "s",
      shotId: "shot007",
    };
    writeFileSync(
      join(dir, "corpus-manifest.json"),
      JSON.stringify({
        schema: "oniq.arap-corpus-manifest/1",
        population: "gateway",
        corpusId: "OWNER_AUTHORIZED_GATEWAY_CORPUS",
        readBase: "https://example.invalid",
        authorization: {
          grantedBy: "owner",
          grantedAt: "2026-09-02",
          scope: "owner-only",
          ownerUserId: owner,
        },
        stills: manifestStills,
      }),
    );
    const out = run(
      "--driver-out",
      join(dir, "out"),
      "--corpus-manifest",
      join(dir, "corpus-manifest.json"),
      "--out-dir",
      join(dir, "decision"),
    );
    expect(out).toContain("population                 gateway");
    expect(out).toContain("supplied / valid / measured 8 / 6 / 6");
    expect(out).toMatch(
      /STATE: (ARAP_ELIGIBILITY_SUPPORTED|ARAP_AS_SELECTIVE_PROVIDER|GATEWAY_INPUT_CONSTRAINT_REQUIRED|REAL_CORPUS_INSUFFICIENT)/,
    );
    const written = JSON.parse(
      readFileSync(join(dir, "decision", "real-gateway-eligibility-reference.report.json"), "utf8"),
    );
    const by = Object.fromEntries(
      written.report.perStill.map((p: { stillId: string }) => [p.stillId, p]),
    );
    expect(by["job-s-shot006"]).toMatchObject({ status: "MALFORMED", measured: false });
    expect(by["job-s-shot006"].reasons[0]).toMatch(/sha256 mismatch/);
    expect(by["job-s-shot007"]).toMatchObject({ status: "MISSING", measured: false });
    expect(by["job-s-shot007"].reasons[0]).toMatch(/NOT_IN_DRIVER_OUTPUT/);
    expect(written.report.counts).toMatchObject({
      supplied: 8,
      valid: 6,
      measured: 6,
      notMeasured: { missing: 1, unauthorized: 0, malformed: 1 },
    });
    expect(written.decision.path[0]).toBe("REAL_GATEWAY_CORPUS_MEASURED");
  }, 200_000);

  it("a driver record whose still is not in the manifest is refused under owner-only, not admitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "arap-11c-"));
    const owner = "d3b58345-owner-0000-0000-000000000000";
    driverOut(join(dir, "out"), [
      { stem: "job-s-shot000", sha: "a".repeat(64) },
      { stem: "stray-s-shot000", sha: "b".repeat(64) },
    ]);
    writeFileSync(
      join(dir, "corpus-manifest.json"),
      JSON.stringify({
        schema: "oniq.arap-corpus-manifest/1",
        population: "gateway",
        corpusId: "OWNER_AUTHORIZED_GATEWAY_CORPUS",
        readBase: "https://example.invalid",
        authorization: {
          grantedBy: "owner",
          grantedAt: "2026-09-02",
          scope: "owner-only",
          ownerUserId: owner,
        },
        stills: {
          "job-s-shot000": {
            ownerUserId: owner,
            jobId: "job",
            sceneId: "s",
            shotId: "shot000",
            sha256: "a".repeat(64),
          },
        },
      }),
    );
    const out = run(
      "--driver-out",
      join(dir, "out"),
      "--corpus-manifest",
      join(dir, "corpus-manifest.json"),
      "--out-dir",
      join(dir, "decision"),
    );
    expect(out).toContain("supplied / valid / measured 2 / 1 / 1");
    const written = JSON.parse(
      readFileSync(join(dir, "decision", "real-gateway-eligibility-reference.report.json"), "utf8"),
    );
    const stray = written.report.perStill.find(
      (p: { stillId: string }) => p.stillId === "stray-s-shot000",
    );
    expect(stray).toMatchObject({ status: "UNAUTHORIZED", measured: false });
    expect(written.decision.state).toBe("REAL_CORPUS_INSUFFICIENT");
  }, 200_000);
});
