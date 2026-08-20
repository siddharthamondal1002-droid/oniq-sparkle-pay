import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  boundedConfidence,
  classifyShotObservation,
  colorDistance,
  safePathHash,
} from '../../src/lib/storyCvEvidence.ts';

const DEFAULT_SCALE = '64:36';
const MAX_SAMPLES = 9;
const MAX_DURATION_MS = 180_000;

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

function parseRate(raw) {
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
  return {
    visualEvidence: {
      version: 1,
      media: { kind: 'unknown', pathHash: safePathHash(pathLike) },
      timing: { durationMs: undefined, fps: undefined, vfr: { value: false, confidence: 0, source: 'unknown' } },
      sceneCuts: { observedCutTimestampsMs: [], transitionHints: [], confidence: 0, source: 'unknown' },
      frames: [],
      composition: {
        shotScale: { value: 'unknown', confidence: 0, source: 'unknown' },
        framingStability: { value: 'unknown', confidence: 0, source: 'unknown' },
      },
      color: {
        luminance: { value: 0, confidence: 0, source: 'unknown' },
        saturation: { value: 0, confidence: 0, source: 'unknown' },
        contrast: { value: 0, confidence: 0, source: 'unknown' },
        dominantColors: { value: [], confidence: 0, source: 'unknown' },
      },
      motion: {
        magnitude: { value: 0, confidence: 0, source: 'unknown' },
        dominantDirection: { value: 'unknown', confidence: 0, source: 'unknown' },
        cameraMovement: { value: 'unknown', confidence: 0, source: 'unknown' },
      },
      subjects: {
        personDetected: { value: null, confidence: 0, source: 'unknown' },
        appearanceEmbeddingAvailable: { value: false, confidence: 1, source: 'unknown' },
        identity: { value: 'UNKNOWN', confidence: 0, source: 'unknown' },
        wardrobe: { dominantColors: { value: [], confidence: 0, source: 'unknown' } },
      },
      faces: {
        detected: { value: null, confidence: 0, source: 'unknown' },
        count: { value: null, confidence: 0, source: 'unknown' },
        boxes: { value: null, confidence: 0, source: 'unknown' },
      },
      objects: {
        detected: { value: null, confidence: 0, source: 'unknown' },
        labels: { value: null, confidence: 0, source: 'unknown' },
      },
      location: {
        indoorOutdoorSignal: { value: 'unknown', confidence: 0, source: 'unknown' },
      },
      screenDirection: { value: 'unknown', confidence: 0, source: 'unknown' },
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
        vfr: {
          value: Boolean(vfr),
          confidence: boundedConfidence(Number.isFinite(fps) ? 0.86 : 0.25),
          source: 'ffprobe',
          detector: { name: 'ffprobe-rate-check', version: '1.0.0' },
        },
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
        shotScale: {
          value: shotScale,
          confidence: boundedConfidence(width > 0 && height > 0 ? 0.6 : 0.2),
          source: 'ffprobe',
          detector: { name: 'resolution-scale-heuristic', version: '1.0.0' },
        },
        framingStability: {
          value: moving ? 'moving' : 'stable',
          confidence: boundedConfidence(0.45 + Math.min(0.4, motionMag * 4)),
          source: 'heuristic',
          detector: { name: 'energy-delta', version: '1.0.0' },
        },
      },
      color: {
        luminance: {
          value: Number(luma.toFixed(3)),
          confidence: evidenceConfidence,
          source: 'ffmpeg',
          detector: { name: 'rgb-luma', version: '1.0.0' },
        },
        saturation: {
          value: Number(sat.toFixed(4)),
          confidence: evidenceConfidence,
          source: 'ffmpeg',
          detector: { name: 'rgb-saturation', version: '1.0.0' },
        },
        contrast: {
          value: Number(contrast.toFixed(3)),
          confidence: evidenceConfidence,
          source: 'ffmpeg',
          detector: { name: 'rgb-contrast', version: '1.0.0' },
        },
        dominantColors: {
          value: [...new Set(dominantPalette)].slice(0, 4),
          confidence: evidenceConfidence,
          source: 'heuristic',
          detector: { name: 'dominant-bin-color', version: '1.0.0' },
        },
        ...(Number.isFinite(locationSimilarity)
          ? {
              histogramSimilarityToPrevious: {
                value: Number(locationSimilarity.toFixed(3)),
                confidence: boundedConfidence((previousEvidence?.confidence ?? 0) * evidenceConfidence),
                source: 'heuristic',
                detector: { name: 'palette-similarity', version: '1.0.0' },
              },
            }
          : {}),
      },
      motion: {
        magnitude: {
          value: Number(motionMag.toFixed(4)),
          confidence: evidenceConfidence,
          source: 'heuristic',
          detector: { name: 'energy-shift', version: '1.0.0' },
        },
        dominantDirection: {
          value: direction,
          confidence: boundedConfidence(0.35 + Math.min(0.5, motionMag * 4.5)),
          source: 'heuristic',
          detector: { name: 'energy-centroid-dx', version: '1.0.0' },
        },
        cameraMovement: {
          value: moving ? 'moving' : 'static',
          confidence: boundedConfidence(0.38 + Math.min(0.52, motionMag * 4)),
          source: 'heuristic',
          detector: { name: 'energy-shift', version: '1.0.0' },
        },
      },
      subjects: {
        personDetected: { value: null, confidence: 0, source: 'unknown' },
        appearanceEmbeddingAvailable: { value: false, confidence: 1, source: 'unknown' },
        identity: { value: 'UNKNOWN', confidence: 0, source: 'unknown' },
        wardrobe: {
          dominantColors: {
            value: [...new Set(dominantPalette)].slice(0, 3),
            confidence: boundedConfidence(evidenceConfidence * 0.8),
            source: 'heuristic',
            detector: { name: 'palette-similarity', version: '1.0.0' },
          },
          ...(previousEvidence
            ? {
                changeVsPrevious: {
                  value: wardrobeChange,
                  confidence: boundedConfidence((previousEvidence.confidence ?? 0) * evidenceConfidence),
                  source: 'heuristic',
                  detector: { name: 'palette-similarity', version: '1.0.0' },
                },
              }
            : {}),
        },
      },
      faces: {
        detected: { value: null, confidence: 0, source: 'unknown' },
        count: { value: null, confidence: 0, source: 'unknown' },
        boxes: { value: null, confidence: 0, source: 'unknown' },
      },
      objects: {
        detected: { value: null, confidence: 0, source: 'unknown' },
        labels: { value: null, confidence: 0, source: 'unknown' },
      },
      location: {
        indoorOutdoorSignal: { value: 'unknown', confidence: 0, source: 'unknown' },
        ...(Number.isFinite(locationSimilarity)
          ? {
              environmentSimilarityToPrevious: {
                value: Number(locationSimilarity.toFixed(3)),
                confidence: boundedConfidence((previousEvidence?.confidence ?? 0) * evidenceConfidence),
                source: 'heuristic',
                detector: { name: 'palette-similarity', version: '1.0.0' },
              },
            }
          : {}),
      },
      screenDirection: {
        value: direction,
        confidence: boundedConfidence(0.3 + Math.min(0.55, motionMag * 5)),
        source: 'heuristic',
        detector: { name: 'energy-centroid-dx', version: '1.0.0' },
      },
      confidence: evidenceConfidence,
    };

    return { visualEvidence, observedShot };
  } catch {
    return cvUnknown(mediaPath);
  }
}
