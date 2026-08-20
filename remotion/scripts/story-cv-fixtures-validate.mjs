import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '../..');
const manifestPath = path.join(rootDir, 'remotion/fixtures/cv-calibration/manifest.json');
const realTemplatePath = path.join(rootDir, 'remotion/fixtures/cv-calibration/manifest.real.template.json');

function fail(message) {
  console.error(`cv-fixtures: ${message}`);
  process.exitCode = 1;
}

function normalizeLabels(labels) {
  return new Set((Array.isArray(labels) ? labels : []).map((x) => String(x).toLowerCase()));
}

const args = new Set(process.argv.slice(2));
const ciMode = args.has('--ci');
const requireReady = args.has('--require-ready');

if (!fs.existsSync(manifestPath)) {
  fail(`missing manifest: ${manifestPath}`);
  process.exit(process.exitCode ?? 1);
}

if (!fs.existsSync(realTemplatePath)) {
  fail(`missing acquisition template: ${realTemplatePath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const status = String(manifest.status ?? 'BLOCKED').toUpperCase();
const policy = {
  minRealClips: Math.max(1, Number(manifest?.readinessPolicy?.minRealClips ?? 5)),
  requiredCategories: Array.isArray(manifest?.readinessPolicy?.requiredCategories)
    ? manifest.readinessPolicy.requiredCategories.map((x) => String(x).toLowerCase())
    : [],
};

if (!Number.isFinite(Number(manifest?.tolerancePolicy?.minimumMs))) {
  fail('tolerancePolicy.minimumMs must be numeric');
}
if (!Number.isFinite(Number(manifest?.tolerancePolicy?.frameMultiplier))) {
  fail('tolerancePolicy.frameMultiplier must be numeric');
}

if (status === 'BLOCKED') {
  if (!Array.isArray(manifest.blockedBy) || manifest.blockedBy.length === 0) {
    fail('status BLOCKED requires a non-empty blockedBy list');
  }
}

const fixtures = Array.isArray(manifest.fixtures) ? manifest.fixtures : [];
const realFixtures = fixtures.filter((fixture) => {
  const mediaPath = String(fixture.mediaPath ?? '').toLowerCase();
  const labels = normalizeLabels(fixture.labels);
  return fixture.mediaKind === 'clip' || /\.(mp4|mov|mkv|webm)$/.test(mediaPath) || labels.has('real-video');
});

for (const fixture of fixtures) {
  const id = String(fixture.id ?? '').trim();
  if (!id) fail('fixture id is required');
  if (!String(fixture.mediaPath ?? '').trim()) fail(`fixture ${id || '<unknown>'} is missing mediaPath`);
  if (!String(fixture.mediaKind ?? '').trim()) fail(`fixture ${id || '<unknown>'} is missing mediaKind`);
  const gt = fixture.groundTruth ?? {};
  if (!Array.isArray(gt.cuts)) fail(`fixture ${id || '<unknown>'} must define groundTruth.cuts[]`);
  for (const cut of gt.cuts ?? []) {
    if (!Number.isFinite(Number(cut?.timeMs))) fail(`fixture ${id}: cut is missing numeric timeMs`);
    if (!Number.isFinite(Number(cut?.toleranceMs))) fail(`fixture ${id}: cut is missing numeric toleranceMs`);
  }
  if (!Array.isArray(gt.continuityEvents)) fail(`fixture ${id || '<unknown>'} must define groundTruth.continuityEvents[]`);
  if (!Array.isArray(fixture.labels)) fail(`fixture ${id || '<unknown>'} must define labels[]`);
  if (!fixture.provenance || typeof fixture.provenance !== 'object') {
    fail(`fixture ${id || '<unknown>'} must define provenance`);
  }
}

const readyGate = requireReady || status === 'READY';
if (readyGate) {
  if (realFixtures.length < policy.minRealClips) {
    fail(`READY gate requires at least ${policy.minRealClips} real clips, found ${realFixtures.length}`);
  }
  const hasPositiveCuts = realFixtures.some((fixture) => Array.isArray(fixture?.groundTruth?.cuts) && fixture.groundTruth.cuts.length > 0);
  const hasNoCut = realFixtures.some((fixture) => Array.isArray(fixture?.groundTruth?.cuts) && fixture.groundTruth.cuts.length === 0);
  if (!hasPositiveCuts) fail('READY gate requires at least one real fixture with positive cut labels');
  if (!hasNoCut) fail('READY gate requires at least one real fixture labelled as no-cut/continuous');

  const seenLabels = new Set(realFixtures.flatMap((fixture) => [...normalizeLabels(fixture.labels)]));
  for (const category of policy.requiredCategories) {
    if (!seenLabels.has(category)) {
      fail(`READY gate missing required category label: ${category}`);
    }
  }
}

if (ciMode && status !== 'READY' && status !== 'BLOCKED') {
  fail(`unsupported manifest status in CI mode: ${status}`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(
  JSON.stringify(
    {
      status,
      realFixtures: realFixtures.length,
      minRealClips: policy.minRealClips,
      readyGateChecked: readyGate,
    },
    null,
    2,
  ),
);
