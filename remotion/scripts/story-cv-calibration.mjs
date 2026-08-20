import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { findBin } from './findFfmpeg.mjs';
import { extractVisualEvidence } from './storyCvEvidenceAdapter.mjs';

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

function toRate(numerator, denominator) {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function resolveOnPath(name) {
  const out = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  if (out.status !== 0) return null;
  return String(out.stdout ?? '').trim() || null;
}

function resolveBin(name) {
  try {
    const local = findBin(name);
    if (local) return { path: local, source: 'findBin' };
  } catch {
    // fall through
  }
  const system = resolveOnPath(name);
  if (system) return { path: system, source: 'path' };
  return { path: null, source: 'unavailable' };
}

function normalizeCuts(rawCuts) {
  if (!Array.isArray(rawCuts)) return [];
  return rawCuts
    .map((entry) => {
      if (typeof entry === 'number') {
        return { timeMs: Number(entry), toleranceMs: undefined };
      }
      if (entry && typeof entry === 'object') {
        return {
          timeMs: Number(entry.timeMs),
          toleranceMs: Number.isFinite(Number(entry.toleranceMs)) ? Number(entry.toleranceMs) : undefined,
        };
      }
      return null;
    })
    .filter((entry) => entry && Number.isFinite(entry.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs);
}

function matchTemporalEvents(expectedCuts, observedTimestampsMs, defaultToleranceMs) {
  const expected = [...(expectedCuts ?? [])]
    .map((entry) => ({
      timeMs: Number(entry.timeMs),
      toleranceMs: Number.isFinite(entry.toleranceMs) ? Number(entry.toleranceMs) : undefined,
    }))
    .filter((entry) => Number.isFinite(entry.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs);
  const observed = [...(observedTimestampsMs ?? [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const used = new Set();
  let tp = 0;
  let fp = 0;

  for (const observedCut of observed) {
    let bestIndex = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < expected.length; i += 1) {
      if (used.has(i)) continue;
      const toleranceMs = Math.max(defaultToleranceMs, expected[i].toleranceMs ?? 0);
      const delta = Math.abs(expected[i].timeMs - observedCut);
      if (delta <= toleranceMs && delta < bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      used.add(bestIndex);
      tp += 1;
    } else {
      fp += 1;
    }
  }

  return {
    tp,
    fp,
    fn: Math.max(0, expected.length - used.size),
  };
}

function summaryFromCounts(tp, fp, fn, opportunities) {
  const tn = Math.max(0, opportunities - tp - fp - fn);
  return {
    tp,
    fp,
    fn,
    tn,
    precision: toRate(tp, tp + fp),
    recall: toRate(tp, tp + fn),
    fpr: toRate(fp, fp + tn),
    fnr: toRate(fn, tp + fn),
  };
}

function compareSignal(expected, observed) {
  if (expected === 'UNKNOWN') return 'UNKNOWN';
  if (observed == null) return 'UNKNOWN';
  if (typeof observed === 'string' && observed.toUpperCase() === 'UNKNOWN') return 'UNKNOWN';
  return expected === observed ? 'MATCH' : 'MISMATCH';
}

function looksLikeRealVideoFixture(fixture) {
  const mediaPath = String(fixture.mediaPath ?? '').toLowerCase();
  const labels = Array.isArray(fixture.labels) ? fixture.labels.map((x) => String(x).toLowerCase()) : [];
  return fixture.mediaKind === 'clip' || /\.(mp4|mov|mkv|webm)$/.test(mediaPath) || labels.includes('real-video');
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '../..');
const manifestPath = path.join(rootDir, 'remotion/fixtures/cv-calibration/manifest.json');
const legacyFixturePath = path.join(rootDir, 'remotion/fixtures/cv-calibration/fixtures.json');
const reportPath = path.join(rootDir, 'remotion/fixtures/cv-calibration/report.json');

const manifestDoc = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { version: 1 };

const readinessPolicy = {
  minRealClips: Math.max(1, Number(manifestDoc?.readinessPolicy?.minRealClips ?? 5)),
  requiredCategories: Array.isArray(manifestDoc?.readinessPolicy?.requiredCategories)
    ? manifestDoc.readinessPolicy.requiredCategories
    : [
        'hard-cut',
        'gradual-transition',
        'continuous-shot',
        'camera-movement',
        'lighting-change',
        'rapid-motion',
        'low-contrast',
        'talking-head',
      ],
};
const tolerancePolicy = {
  minimumMs: Math.max(1, Number(manifestDoc?.tolerancePolicy?.minimumMs ?? 50)),
  frameMultiplier: Math.max(0.1, Number(manifestDoc?.tolerancePolicy?.frameMultiplier ?? 2)),
};

const sourceFixtures =
  Array.isArray(manifestDoc.fixtures) && manifestDoc.fixtures.length > 0
    ? manifestDoc.fixtures
    : JSON.parse(fs.readFileSync(legacyFixturePath, 'utf8')).fixtures;

const fixtures = (Array.isArray(sourceFixtures) ? sourceFixtures : []).map((fixture, index) => {
  const groundTruth = fixture.groundTruth ?? {};
  const cuts = normalizeCuts(groundTruth.cuts ?? groundTruth.sceneCutsMs ?? []);
  return {
    ...fixture,
    id: fixture.id ?? `fixture_${index + 1}`,
    mediaKind: fixture.mediaKind ?? (String(fixture.mediaPath ?? '').match(/\.(mp4|mov|mkv|webm)$/i) ? 'clip' : 'still'),
    groundTruth: {
      ...groundTruth,
      cuts,
      sceneCutsMs: cuts.map((x) => x.timeMs),
    },
  };
});

const ffmpegInfo = resolveBin('ffmpeg');
const ffprobeInfo = resolveBin('ffprobe');
const extractorAvailable = Boolean(ffmpegInfo.path && ffprobeInfo.path);

const rows = [];
const runtimeMs = [];
const rssBytes = [];

let boundaryTp = 0;
let boundaryFp = 0;
let boundaryFn = 0;
let boundaryOpportunities = 0;
let boundaryEligibleFixtures = 0;

const perSignal = {
  motionDirection: { match: 0, mismatch: 0, unknown: 0 },
  screenDirection: { match: 0, mismatch: 0, unknown: 0 },
  cameraMovement: { match: 0, mismatch: 0, unknown: 0 },
  identity: { match: 0, mismatch: 0, unknown: 0 },
  shotScale: { match: 0, mismatch: 0, unknown: 0 },
};

const realFixtures = fixtures.filter((fixture) => looksLikeRealVideoFixture(fixture));
const categoryCoverage = new Set(
  realFixtures.flatMap((fixture) =>
    (Array.isArray(fixture.labels) ? fixture.labels : []).map((value) => String(value).toLowerCase()),
  ),
);

for (const [index, fixture] of fixtures.entries()) {
  const mediaPath = path.join(rootDir, String(fixture.mediaPath ?? ''));
  const mediaExists = fs.existsSync(mediaPath);

  const rssStart = process.memoryUsage().rss;
  const start = performance.now();
  const out = extractVisualEvidence({
    ffmpeg: ffmpegInfo.path,
    ffprobe: ffprobeInfo.path,
    mediaPath,
    mediaKind: fixture.mediaKind,
    expectedShotId: index + 1,
    maxSamples: 9,
  });
  const elapsedMs = Number((performance.now() - start).toFixed(2));
  const rssDelta = process.memoryUsage().rss - rssStart;
  runtimeMs.push(elapsedMs);
  rssBytes.push(rssDelta);

  const gtCuts = fixture.groundTruth?.cuts ?? [];
  const observedCuts = out.visualEvidence?.sceneCuts?.observedCutTimestampsMs ?? [];
  const fps = Number(out.visualEvidence?.timing?.fps ?? NaN);
  const frameDurationMs = Number.isFinite(fps) && fps > 0 ? 1000 / fps : null;
  const defaultToleranceMs = Math.max(
    tolerancePolicy.minimumMs,
    frameDurationMs != null ? frameDurationMs * tolerancePolicy.frameMultiplier : 0,
  );
  const matched = matchTemporalEvents(gtCuts, observedCuts, defaultToleranceMs);

  const sampleCount = Number(out.visualEvidence?.frames?.length ?? 0);
  const adaptiveSampleCount = Number(
    (out.visualEvidence?.frames ?? []).filter((frame) => frame.reason === 'adaptive').length,
  );
  const opportunities = sampleCount > 1 ? sampleCount - 1 : 0;
  const extractorMode =
    !extractorAvailable || sampleCount === 0 ? 'EXTRACTOR_UNAVAILABLE' : out.visualEvidence?.sceneCuts?.source ?? 'heuristic';
  const eligibleForBoundaryMetrics = extractorMode !== 'EXTRACTOR_UNAVAILABLE' && mediaExists;

  if (eligibleForBoundaryMetrics) {
    boundaryTp += matched.tp;
    boundaryFp += matched.fp;
    boundaryFn += matched.fn;
    boundaryOpportunities += opportunities;
    boundaryEligibleFixtures += 1;
  }

  for (const signal of Object.keys(perSignal)) {
    const expected = fixture.groundTruth?.[signal] ?? 'UNKNOWN';
    const observed =
      signal === 'motionDirection'
        ? out.visualEvidence?.motion?.dominantDirection?.value
        : signal === 'cameraMovement'
          ? out.visualEvidence?.motion?.cameraMovement?.value
          : signal === 'screenDirection'
            ? out.visualEvidence?.screenDirection?.value
            : signal === 'identity'
              ? out.visualEvidence?.subjects?.identity?.value
              : out.visualEvidence?.composition?.shotScale?.value;

    const status = compareSignal(expected, observed);
    if (status === 'UNKNOWN') perSignal[signal].unknown += 1;
    else if (status === 'MATCH') perSignal[signal].match += 1;
    else perSignal[signal].mismatch += 1;
  }

  const boundarySummary = eligibleForBoundaryMetrics
    ? summaryFromCounts(matched.tp, matched.fp, matched.fn, opportunities)
    : {
        tp: matched.tp,
        fp: matched.fp,
        fn: matched.fn,
        tn: 0,
        precision: null,
        recall: null,
        fpr: null,
        fnr: null,
      };

  rows.push({
    fixture: fixture.id,
    mediaPath: fixture.mediaPath,
    mediaKind: fixture.mediaKind,
    mediaExists,
    labels: fixture.labels ?? [],
    provenance: fixture.provenance ?? {},
    groundTruth: {
      ...fixture.groundTruth,
      cuts: gtCuts,
      sceneCutsMs: gtCuts.map((x) => x.timeMs),
    },
    observed: {
      sceneCutsMs: observedCuts,
      motionDirection: out.visualEvidence?.motion?.dominantDirection?.value,
      cameraMovement: out.visualEvidence?.motion?.cameraMovement?.value,
      screenDirection: out.visualEvidence?.screenDirection?.value,
      identity: out.visualEvidence?.subjects?.identity?.value,
      shotScale: out.visualEvidence?.composition?.shotScale?.value,
      confidence: out.visualEvidence?.confidence ?? 0,
      durationMs: out.visualEvidence?.timing?.durationMs ?? null,
      fps: Number.isFinite(fps) ? Number(fps.toFixed(3)) : null,
      vfr: out.visualEvidence?.timing?.vfr?.value ?? null,
      sampleCount,
      adaptiveSampleCount,
      subprocesses: 1 + sampleCount,
    },
    extractor: {
      mode: extractorMode,
      ffmpegAvailable: Boolean(ffmpegInfo.path),
      ffprobeAvailable: Boolean(ffprobeInfo.path),
      ffmpegPath: ffmpegInfo.path,
      ffprobePath: ffprobeInfo.path,
    },
    boundary: {
      eligibleForMetrics: eligibleForBoundaryMetrics,
      toleranceMs: Number(defaultToleranceMs.toFixed(2)),
      tp: boundarySummary.tp,
      fp: boundarySummary.fp,
      fn: boundarySummary.fn,
      tn: boundarySummary.tn,
      precision: boundarySummary.precision,
      recall: boundarySummary.recall,
      fpr: boundarySummary.fpr,
      fnr: boundarySummary.fnr,
    },
    runtimeMs: elapsedMs,
    rssDeltaBytes: rssDelta,
  });
}

const boundaryAggregate =
  boundaryEligibleFixtures > 0
    ? summaryFromCounts(boundaryTp, boundaryFp, boundaryFn, boundaryOpportunities)
    : {
        tp: boundaryTp,
        fp: boundaryFp,
        fn: boundaryFn,
        tn: 0,
        precision: null,
        recall: null,
        fpr: null,
        fnr: null,
      };

const signalSummary = Object.fromEntries(
  Object.entries(perSignal).map(([key, value]) => {
    const known = value.match + value.mismatch;
    return [
      key,
      {
        ...value,
        known,
        accuracy: toRate(value.match, known),
      },
    ];
  }),
);

const blockedReasons = [];
if (!extractorAvailable) blockedReasons.push('EXTRACTOR_UNAVAILABLE');
if (realFixtures.length < readinessPolicy.minRealClips) blockedReasons.push('REAL_FIXTURE_COUNT_UNDER_MINIMUM');
if (!realFixtures.some((fixture) => (fixture.groundTruth?.cuts ?? []).length > 0)) blockedReasons.push('NO_POSITIVE_CUT_LABELS');
if (!realFixtures.some((fixture) => (fixture.groundTruth?.cuts ?? []).length === 0)) blockedReasons.push('NO_NO_CUT_LABELS');
for (const requiredCategory of readinessPolicy.requiredCategories) {
  if (!categoryCoverage.has(String(requiredCategory).toLowerCase())) {
    blockedReasons.push(`MISSING_CATEGORY:${requiredCategory}`);
  }
}

const decisionGate = blockedReasons.length === 0 ? 'READY_FOR_BENCHMARK' : 'BLOCKED';

const report = {
  generatedAt: new Date().toISOString(),
  fixtureCount: fixtures.length,
  extractor: {
    mode: extractorAvailable ? 'AVAILABLE' : 'EXTRACTOR_UNAVAILABLE',
    ffmpegAvailable: Boolean(ffmpegInfo.path),
    ffprobeAvailable: Boolean(ffprobeInfo.path),
    ffmpegPath: ffmpegInfo.path,
    ffprobePath: ffprobeInfo.path,
    ffmpegSource: ffmpegInfo.source,
    ffprobeSource: ffprobeInfo.source,
  },
  tolerancePolicy: {
    minimumMs: tolerancePolicy.minimumMs,
    frameMultiplier: tolerancePolicy.frameMultiplier,
    formula: 'max(minimumMs, frameDurationMs * frameMultiplier)',
  },
  boundedSampling: {
    maxSamples: 9,
    maxDurationMs: 180000,
  },
  readiness: {
    policy: readinessPolicy,
    status: manifestDoc.status ?? 'BLOCKED',
    realFixtureCount: realFixtures.length,
    categoryCoverage: [...categoryCoverage].sort(),
  },
  rows,
  aggregate: {
    boundary: {
      ...boundaryAggregate,
      eligibleFixtures: boundaryEligibleFixtures,
      opportunities: boundaryOpportunities,
    },
    signals: signalSummary,
    performance: {
      wallTimeMs: {
        p50: percentile(runtimeMs, 50),
        p95: percentile(runtimeMs, 95),
        total: Number(runtimeMs.reduce((a, b) => a + b, 0).toFixed(2)),
      },
      rssDeltaBytes: {
        p50: percentile(rssBytes, 50),
        p95: percentile(rssBytes, 95),
        max: rssBytes.length ? Math.max(...rssBytes) : 0,
      },
      sampleCount: {
        p50: percentile(rows.map((r) => r.observed.sampleCount), 50),
        p95: percentile(rows.map((r) => r.observed.sampleCount), 95),
      },
      adaptiveSampleCount: {
        p50: percentile(rows.map((r) => r.observed.adaptiveSampleCount), 50),
        p95: percentile(rows.map((r) => r.observed.adaptiveSampleCount), 95),
      },
      subprocessCount: {
        p50: percentile(rows.map((r) => r.observed.subprocesses), 50),
        p95: percentile(rows.map((r) => r.observed.subprocesses), 95),
      },
    },
  },
  blockedReasons,
  limitations: [
    ...(extractorAvailable ? [] : ['EXTRACTOR_UNAVAILABLE: ffmpeg/ffprobe are missing or unresolved in this runtime.']),
    ...(realFixtures.length >= readinessPolicy.minRealClips
      ? []
      : [`REAL_FIXTURE_COUNT_UNDER_MINIMUM: found ${realFixtures.length}, need at least ${readinessPolicy.minRealClips}.`]),
    ...(blockedReasons.includes('NO_POSITIVE_CUT_LABELS')
      ? ['NO_POSITIVE_CUT_LABELS: no committed real clip has independent positive cut annotations yet.']
      : []),
    ...(blockedReasons.includes('NO_NO_CUT_LABELS')
      ? ['NO_NO_CUT_LABELS: no committed real clip is labelled as continuous/no-cut yet.']
      : []),
  ],
  decisionGate,
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`story-cv-calibration: wrote ${reportPath}`);
console.log(
  JSON.stringify(
    {
      extractor: report.extractor,
      boundary: report.aggregate.boundary,
      blockedReasons: report.blockedReasons,
      decisionGate: report.decisionGate,
    },
    null,
    2,
  ),
);
