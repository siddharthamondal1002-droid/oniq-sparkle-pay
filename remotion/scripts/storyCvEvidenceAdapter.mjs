import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  boundedConfidence,
  classifyShotObservation,
  colorDistance,
  evidenceStateFor,
  safePathHash,
} from '../../src/lib/storyCvEvidence.ts';

const DEFAULT_SCALE = '64:36';
const MAX_SAMPLES = 9;
const MAX_DURATION_MS = 180_000;
const CONTRACT_VERSION = 1;

function samplingInfo(overrides = {}) {
  return {
    bounded: true,
    strategy: 'first-middle-last-adaptive',
    maxSamples: MAX_SAMPLES,
    actualSamples: 0,
    maxDurationMs: MAX_DURATION_MS,
    sampleScale: DEFAULT_SCALE,
    ...overrides,
  };
}

function evidence(value, confidence, source, detector, sampling, provenanceMethod) {
  return {
    value,
    confidence: boundedConfidence(confidence),
    source,
    state: evidenceStateFor({ source, confidence, value }),
    provenance: { method: provenanceMethod ?? (detector?.name || 'unknown') },
    ...(sampling ? { sampling } : {}),
    ...(detector ? { detector } : {}),
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function run(bin, args, opts = {}) {
  return execFileSync(bin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeoutMs ?? 15_000,
    maxBuffer: opts.maxBuffer ?? 12 * 1024 * 1024,
  });
}

export function parseRate(raw) {
  if (!raw) return 0;
  const s = String(raw);
  if (!s.includes('/')) return Number(s) || 0;
  const [a, b] = s.split('/');
  const num = Number(a);
  const den = Number(b);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

function probe(ffprobe, file) {
  const out = run(ffprobe, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    file,
  ]).toString();
  return JSON.parse(out);
}

function rgbAt(ffmpeg, file, seconds, scale = DEFAULT_SCALE) {
  const out = run(ffmpeg, [
    '-v', 'error',
    '-ss', String(Math.max(0, seconds)),
    '-i', file,
    '-frames:v', '1',
    '-vf', `scale=${scale}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ]);
  return out;
}

function descriptor(rgb, timestampMs, width, height) {
  const bins = new Array(12).fill(0);
  let lumaSum = 0;
  let satSum = 0;
  let maxL = 0;
  let minL = 255;
  const pixels = Math.floor(rgb.length / 3);
  if (pixels === 0) {
    return {
      timestampMs,
      luminance: 0,
      saturation: 0,
      contrast: 0,
      dominantColors: [],
      energyX: 0,
      energyY: 0,
      width,
      height,
    };
  }

  let energyX = 0;
  let energyY = 0;
  for (let i = 0, p = 0; i < rgb.length - 2; i += 3, p += 1) {
    const r = rgb[i];
    const g = rgb[i + 1];
    const b = rgb[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumaSum += l;
    satSum += max === 0 ? 0 : (max - min) / max;
    if (l > maxL) maxL = l;
    if (l < minL) minL = l;

    const channel = max === r ? 0 : max === g ? 1 : 2;
    const level = Math.floor(max / 86); // 0-2
    bins[channel * 4 + level] += 1;

    const x = p % width;
    const y = Math.floor(p / width);
    const centeredX = (x / Math.max(1, width - 1)) - 0.5;
    const centeredY = (y / Math.max(1, height - 1)) - 0.5;
    const energy = Math.abs(l - 127.5);
    energyX += centeredX * energy;
    energyY += centeredY * energy;
  }

  const dominantColors = bins
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map(({ i }) => {
      const channel = Math.floor(i / 4);
      const level = i % 4;
      const amp = clamp(level * 85 + 42, 0, 255);
      const rgbTriplet = channel === 0 ? [amp, 64, 64] : channel === 1 ? [64, amp, 64] : [64, 64, amp];
      return `#${rgbTriplet.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
    });

  return {
    timestampMs,
    luminance: lumaSum / pixels,
    saturation: satSum / pixels,
    contrast: maxL - minL,
    dominantColors,
    energyX: energyX / pixels,
    energyY: energyY / pixels,
    width,
    height,
  };
}

function diffScore(a, b) {
  const luma = Math.abs(a.luminance - b.luminance) / 255;
  const sat = Math.abs(a.saturation - b.saturation);
  const color = colorDistance(a.dominantColors, b.dominantColors);
  return luma * 0.45 + sat * 0.2 + color * 0.35;
}

function sampleTimes(durationMs, maxSamples) {
  const safeDuration = Math.max(1, durationMs);
  const first = 0;
  const middle = safeDuration * 0.5;
  const last = Math.max(0, safeDuration - 60);
  const set = new Set([first, middle, last].map((x) => Math.round(x)));
  const extraCount = Math.max(0, Math.min(maxSamples - set.size, 4));
  for (let i = 1; i <= extraCount; i += 1) {
    set.add(Math.round((safeDuration * i) / (extraCount + 1)));
  }
  return [...set].sort((a, b) => a - b);
}

function cvUnknown(pathLike) {
  const sampling = samplingInfo();
  return {
    visualEvidence: {
      version: 1,
      contractVersion: CONTRACT_VERSION,
      sampling,
      media: { kind: 'unknown', pathHash: safePathHash(pathLike) },
      timing: { durationMs: undefined, fps: undefined, vfr: evidence(false, 0, 'unknown', null, sampling, 'missing-media') },
      sceneCuts: { observedCutTimestampsMs: [], transitionHints: [], confidence: 0, source: 'unknown' },
      frames: [],
      composition: {
        shotScale: evidence('unknown', 0, 'unknown', null, sampling, 'missing-media'),
        framingStability: evidence('unknown', 0, 'unknown', null, sampling, 'missing-media'),
      },
      color: {
        luminance: evidence(0, 0, 'unknown', null, sampling, 'missing-media'),
        saturation: evidence(0, 0, 'unknown', null, sampling, 'missing-media'),
        contrast: evidence(0, 0, 'unknown', null, sampling, 'missing-media'),
        dominantColors: evidence([], 0, 'unknown', null, sampling, 'missing-media'),
      },
      motion: {
        magnitude: evidence(0, 0, 'unknown', null, sampling, 'missing-media'),
        dominantDirection: evidence('unknown', 0, 'unknown', null, sampling, 'missing-media'),
        cameraMovement: evidence('unknown', 0, 'unknown', null, sampling, 'missing-media'),
      },
      subjects: {
        personDetected: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
        appearanceEmbeddingAvailable: evidence(false, 1, 'unknown', null, sampling, 'unsupported'),
        identity: evidence('UNKNOWN', 0, 'unknown', null, sampling, 'unsupported'),
        wardrobe: { dominantColors: evidence([], 0, 'unknown', null, sampling, 'unsupported') },
      },
      faces: {
        detected: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
        count: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
        boxes: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
      },
      objects: {
        detected: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
        labels: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
      },
      location: {
        indoorOutdoorSignal: evidence('unknown', 0, 'unknown', null, sampling, 'unsupported'),
      },
      screenDirection: evidence('unknown', 0, 'unknown', null, sampling, 'missing-media'),
      confidence: 0,
    },
    observedShot: null,
  };
}

export function extractVisualEvidence(input) {
  const {
    ffmpeg,
    ffprobe,
    mediaPath,
    mediaKind,
    expectedShotId,
    expectedDurationSeconds,
    previousEvidence,
    maxSamples = MAX_SAMPLES,
  } = input ?? {};

  if (!ffmpeg || !ffprobe || !mediaPath || !fs.existsSync(mediaPath)) {
    return cvUnknown(String(mediaPath ?? 'missing-media'));
  }

  try {
    const p = probe(ffprobe, mediaPath);
    const video = (p.streams ?? []).find((s) => s.codec_type === 'video') ?? {};
    const durationSec = clamp(Number(p.format?.duration ?? expectedDurationSeconds ?? 0), 0, MAX_DURATION_MS / 1000);
    const durationMs = durationSec > 0 ? Math.round(durationSec * 1000) : undefined;
    const fps = parseRate(video.avg_frame_rate ?? video.r_frame_rate ?? 0);
    const vfr = Math.abs(parseRate(video.avg_frame_rate) - parseRate(video.r_frame_rate)) > 0.2;
    const width = Number(video.width ?? 0) || 0;
    const height = Number(video.height ?? 0) || 0;

    const times = sampleTimes(durationMs ?? 1200, Math.max(3, Math.min(maxSamples, MAX_SAMPLES)));
    const sampling = samplingInfo({ actualSamples: times.length });
    const samples = [];
    for (const t of times) {
      const rgb = rgbAt(ffmpeg, mediaPath, t / 1000);
      samples.push(descriptor(rgb, t, 64, 36));
    }

    const cuts = [];
    const diffValues = [];
    for (let i = 1; i < samples.length; i += 1) {
      const d = diffScore(samples[i - 1], samples[i]);
      diffValues.push(d);
    }
    const baseline = diffValues.length > 0 ? diffValues.reduce((a, b) => a + b, 0) / diffValues.length : 0;
    for (let i = 1; i < samples.length; i += 1) {
      const d = diffScore(samples[i - 1], samples[i]);
      if (d > Math.max(0.34, baseline * 1.65)) cuts.push(samples[i].timestampMs);
    }

    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const luma = avg(samples.map((x) => x.luminance));
    const sat = avg(samples.map((x) => x.saturation));
    const contrast = avg(samples.map((x) => x.contrast));

    const first = samples[0];
    const last = samples[samples.length - 1] ?? first;
    const dx = (last.energyX ?? 0) - (first.energyX ?? 0);
    const motionMag = Math.abs(dx) + Math.abs((last.energyY ?? 0) - (first.energyY ?? 0));
    let direction = 'static';
    if (Math.abs(dx) > 0.035) direction = dx > 0 ? 'left_to_right' : 'right_to_left';
    if (motionMag > 0.16 && Math.abs(dx) <= 0.025) direction = 'mixed';
    const moving = motionMag > 0.07;

    const dominantPalette = samples.flatMap((x) => x.dominantColors).slice(0, 6);

    const shotScale =
      width > 0 && height > 0
        ? width * height <= 640 * 360
          ? 'close'
          : width * height <= 1280 * 720
            ? 'medium'
            : 'wide'
        : 'unknown';

    const evidenceConfidence = boundedConfidence(
      0.4 +
        (samples.length >= 3 ? 0.2 : 0) +
        (Number.isFinite(fps) && fps > 0 ? 0.12 : 0) +
        (durationMs ? 0.12 : 0) +
        (width > 0 && height > 0 ? 0.16 : 0),
    );

    const observedShot = classifyShotObservation({
      expectedShotId: Number(expectedShotId ?? 0),
      expectedDurationMs: Number.isFinite(expectedDurationSeconds) ? Math.round(expectedDurationSeconds * 1000) : undefined,
      observedDurationMs: durationMs,
      observedCutCount: cuts.length,
      evidenceConfidence,
    });

    const previousPalette = previousEvidence?.color?.dominantColors?.value ?? [];
    const locationSimilarity =
      previousPalette.length > 0 ? 1 - colorDistance(previousPalette, dominantPalette) : undefined;
    const wardrobeChange =
      previousPalette.length > 0
        ? locationSimilarity >= 0.7
          ? 'MATCH'
          : locationSimilarity >= 0.45
            ? 'POSSIBLE_CHANGE'
            : 'LIKELY_CHANGE'
        : 'UNKNOWN';

    const visualEvidence = {
      version: 1,
      contractVersion: CONTRACT_VERSION,
      sampling,
      media: {
        kind: mediaKind === 'still' ? 'still' : mediaKind === 'clip' ? 'clip' : 'unknown',
        pathHash: safePathHash(mediaPath),
        codec: String(video.codec_name ?? ''),
        width: width || undefined,
        height: height || undefined,
      },
      timing: {
        durationMs,
        fps: Number.isFinite(fps) ? Number(fps.toFixed(3)) : undefined,
        vfr: evidence(
          Boolean(vfr),
          Number.isFinite(fps) ? 0.86 : 0.25,
          'ffprobe',
          { name: 'ffprobe-rate-check', version: '1.0.0' },
          sampling,
        ),
      },
      sceneCuts: {
        observedCutTimestampsMs: cuts,
        transitionHints: cuts.map(() => 'cut'),
        confidence: boundedConfidence(0.52 + Math.min(0.28, cuts.length * 0.08)),
        source: 'heuristic',
      },
      frames: times.map((t, idx) => ({
        timestampMs: t,
        width: 64,
        height: 36,
        reason: idx === 0 ? 'first' : idx === times.length - 1 ? 'last' : idx === Math.floor(times.length / 2) ? 'middle' : 'adaptive',
      })),
      composition: {
        shotScale: evidence(
          shotScale,
          width > 0 && height > 0 ? 0.6 : 0.2,
          'ffprobe',
          { name: 'resolution-scale-heuristic', version: '1.0.0' },
          sampling,
        ),
        framingStability: evidence(
          moving ? 'moving' : 'stable',
          0.45 + Math.min(0.4, motionMag * 4),
          'heuristic',
          { name: 'energy-delta', version: '1.0.0' },
          sampling,
        ),
      },
      color: {
        luminance: evidence(
          Number(luma.toFixed(3)),
          evidenceConfidence,
          'ffmpeg',
          { name: 'rgb-luma', version: '1.0.0' },
          sampling,
        ),
        saturation: evidence(
          Number(sat.toFixed(4)),
          evidenceConfidence,
          'ffmpeg',
          { name: 'rgb-saturation', version: '1.0.0' },
          sampling,
        ),
        contrast: evidence(
          Number(contrast.toFixed(3)),
          evidenceConfidence,
          'ffmpeg',
          { name: 'rgb-contrast', version: '1.0.0' },
          sampling,
        ),
        dominantColors: evidence(
          [...new Set(dominantPalette)].slice(0, 4),
          evidenceConfidence,
          'heuristic',
          { name: 'dominant-bin-color', version: '1.0.0' },
          sampling,
        ),
        ...(Number.isFinite(locationSimilarity)
          ? {
              histogramSimilarityToPrevious: evidence(
                Number(locationSimilarity.toFixed(3)),
                (previousEvidence?.confidence ?? 0) * evidenceConfidence,
                'heuristic',
                { name: 'palette-similarity', version: '1.0.0' },
                sampling,
              ),
            }
          : {}),
      },
      motion: {
        magnitude: evidence(
          Number(motionMag.toFixed(4)),
          evidenceConfidence,
          'heuristic',
          { name: 'energy-shift', version: '1.0.0' },
          sampling,
        ),
        dominantDirection: evidence(
          direction,
          0.35 + Math.min(0.5, motionMag * 4.5),
          'heuristic',
          { name: 'energy-centroid-dx', version: '1.0.0' },
          sampling,
        ),
        cameraMovement: evidence(
          moving ? 'moving' : 'static',
          0.38 + Math.min(0.52, motionMag * 4),
          'heuristic',
          { name: 'energy-shift', version: '1.0.0' },
          sampling,
        ),
      },
      subjects: {
        personDetected: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
        appearanceEmbeddingAvailable: evidence(false, 1, 'unknown', null, sampling, 'unsupported'),
        identity: evidence('UNKNOWN', 0, 'unknown', null, sampling, 'unsupported'),
        wardrobe: {
          dominantColors: evidence(
            [...new Set(dominantPalette)].slice(0, 3),
            evidenceConfidence * 0.8,
            'heuristic',
            { name: 'palette-similarity', version: '1.0.0' },
            sampling,
          ),
          ...(previousEvidence
            ? {
                changeVsPrevious: evidence(
                  wardrobeChange,
                  (previousEvidence.confidence ?? 0) * evidenceConfidence,
                  'heuristic',
                  { name: 'palette-similarity', version: '1.0.0' },
                  sampling,
                ),
              }
            : {}),
        },
      },
      faces: {
        detected: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
        count: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
        boxes: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
      },
      objects: {
        detected: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
        labels: evidence(null, 0, 'unknown', null, sampling, 'unsupported'),
      },
      location: {
        indoorOutdoorSignal: evidence('unknown', 0, 'unknown', null, sampling, 'unsupported'),
        ...(Number.isFinite(locationSimilarity)
          ? {
              environmentSimilarityToPrevious: evidence(
                Number(locationSimilarity.toFixed(3)),
                (previousEvidence?.confidence ?? 0) * evidenceConfidence,
                'heuristic',
                { name: 'palette-similarity', version: '1.0.0' },
                sampling,
              ),
            }
          : {}),
      },
      screenDirection: evidence(
        direction,
        0.3 + Math.min(0.55, motionMag * 5),
        'heuristic',
        { name: 'energy-centroid-dx', version: '1.0.0' },
        sampling,
      ),
      confidence: evidenceConfidence,
    };

    return { visualEvidence, observedShot };
  } catch {
    return cvUnknown(mediaPath);
  }
}
