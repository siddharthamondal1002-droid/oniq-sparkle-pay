import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

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

function matchTemporalEvents(expectedTimestampsMs, observedTimestampsMs, toleranceMs) {
  const expected = [...(expectedTimestampsMs ?? [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const observed = [...(observedTimestampsMs ?? [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const used = new Set();
  let tp = 0;
  let fp = 0;

  for (const observedCut of observed) {
    let bestIndex = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < expected.length; i += 1) {
      if (used.has(i)) continue;
      const delta = Math.abs(expected[i] - observedCut);
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

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '../..');
const fixturePath = path.join(rootDir, 'remotion/fixtures/cv-calibration/fixtures.json');
const reportPath = path.join(rootDir, 'remotion/fixtures/cv-calibration/report.json');

const fixtureDoc = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const fixtures = Array.isArray(fixtureDoc.fixtures) ? fixtureDoc.fixtures : [];
const toleranceMs = Math.max(1, Number(fixtureDoc.toleranceMs ?? 80));

function resolveBin(name) {
  try {
    return findBin(name);
  } catch {
    return null;
  }
}

const ffmpeg = resolveBin('ffmpeg');
const ffprobe = resolveBin('ffprobe');

const rows = [];
const runtimeMs = [];
const rssBytes = [];

let boundaryTp = 0;
let boundaryFp = 0;
let boundaryFn = 0;
let boundaryOpportunities = 0;

const perSignal = {
  motionDirection: { match: 0, mismatch: 0, unknown: 0 },
  screenDirection: { match: 0, mismatch: 0, unknown: 0 },
  cameraMovement: { match: 0, mismatch: 0, unknown: 0 },
  identity: { match: 0, mismatch: 0, unknown: 0 },
  shotScale: { match: 0, mismatch: 0, unknown: 0 },
};

for (const [index, fixture] of fixtures.entries()) {
  const mediaPath = path.join(rootDir, String(fixture.mediaPath ?? ''));
  if (!fs.existsSync(mediaPath)) {
    throw new Error(`fixture media missing: ${mediaPath}`);
  }

  const rssStart = process.memoryUsage().rss;
  const start = performance.now();
  const out = extractVisualEvidence({
    ffmpeg,
    ffprobe,
    mediaPath,
    mediaKind: fixture.mediaKind,
    expectedShotId: index + 1,
    maxSamples: 9,
  });
  const elapsedMs = Number((performance.now() - start).toFixed(2));
  const rssDelta = process.memoryUsage().rss - rssStart;
  runtimeMs.push(elapsedMs);
  rssBytes.push(rssDelta);

  const gtCuts = fixture.groundTruth?.sceneCutsMs ?? [];
  const observedCuts = out.visualEvidence?.sceneCuts?.observedCutTimestampsMs ?? [];
  const matched = matchTemporalEvents(gtCuts, observedCuts, toleranceMs);
  const opportunities = Math.max(1, (out.visualEvidence?.frames?.length ?? 1) - 1);

  boundaryTp += matched.tp;
  boundaryFp += matched.fp;
  boundaryFn += matched.fn;
  boundaryOpportunities += opportunities;

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

  const boundarySummary = summaryFromCounts(matched.tp, matched.fp, matched.fn, opportunities);

  rows.push({
    fixture: fixture.id,
    groundTruth: fixture.groundTruth,
    observed: {
      sceneCutsMs: observedCuts,
      motionDirection: out.visualEvidence?.motion?.dominantDirection?.value,
      cameraMovement: out.visualEvidence?.motion?.cameraMovement?.value,
      screenDirection: out.visualEvidence?.screenDirection?.value,
      identity: out.visualEvidence?.subjects?.identity?.value,
      shotScale: out.visualEvidence?.composition?.shotScale?.value,
      confidence: out.visualEvidence?.confidence ?? 0,
      sampleCount: out.visualEvidence?.frames?.length ?? 0,
      subprocesses: 1 + (out.visualEvidence?.frames?.length ?? 0),
    },
    metrics: {
      tp: boundarySummary.tp,
      fp: boundarySummary.fp,
      fn: boundarySummary.fn,
      precision: boundarySummary.precision,
      recall: boundarySummary.recall,
      fpr: boundarySummary.fpr,
      fnr: boundarySummary.fnr,
    },
    runtimeMs: elapsedMs,
    rssDeltaBytes: rssDelta,
  });
}

const boundaryAggregate = summaryFromCounts(boundaryTp, boundaryFp, boundaryFn, boundaryOpportunities);

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

const report = {
  generatedAt: new Date().toISOString(),
  fixtureCount: fixtures.length,
  toleranceMs,
  boundedSampling: {
    maxSamples: 9,
    maxDurationMs: 180000,
  },
  rows,
  aggregate: {
    boundary: boundaryAggregate,
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
      subprocessCount: {
        p50: percentile(rows.map((r) => r.observed.subprocesses), 50),
        p95: percentile(rows.map((r) => r.observed.subprocesses), 95),
      },
    },
  },
  limitations: [
    ...(ffmpeg && ffprobe
      ? []
      : ['ffmpeg/ffprobe not available in this runtime; extraction executed in UNKNOWN fallback mode.']),
    'Repository fixtures currently contain committed still images but no committed real video clips/mp4s for cut-positive calibration.',
    'Boundary recall/FNR are under-constrained without positive cut labels from real clips.',
    'Motion/screen-direction on still fixtures validate UNKNOWN-safe/static behavior, not moving-scene accuracy.',
  ],
  decisionGate: 'BLOCKED',
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`story-cv-calibration: wrote ${reportPath}`);
console.log(JSON.stringify({ boundary: boundaryAggregate, performance: report.aggregate.performance }, null, 2));
