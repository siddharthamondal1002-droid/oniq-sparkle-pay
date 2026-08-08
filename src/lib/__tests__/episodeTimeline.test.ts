import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSITION_SECONDS,
  MAX_TOTAL_SECONDS,
  planTimeline,
} from '../episodeTimeline';

const scene = (over: Record<string, unknown> = {}) => ({
  stillPath: 'ep1_s01.png',
  durationSeconds: 10,
  motion: 'zoomIn' as const,
  ...over,
});

describe('planTimeline', () => {
  it('defaults the transition to 0.5s and never dissolves into the first scene', () => {
    const plan = planTimeline([scene(), scene({ motion: 'zoomOut' })]);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.scenes[0].transitionSeconds).toBe(0);
    expect(plan.scenes[1].transitionSeconds).toBe(DEFAULT_TRANSITION_SECONDS);
    expect(plan.totalSeconds).toBe(19.5);
  });

  it('flips a repeated zoom so the episode does not pulse', () => {
    const plan = planTimeline([scene(), scene(), scene()]);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.scenes.map((s) => s.motion)).toEqual(['zoomIn', 'zoomOut', 'zoomIn']);
    expect(plan.adjustments.length).toBe(2);
  });

  it('leaves pans and static scenes alone', () => {
    const plan = planTimeline([scene({ motion: 'panLeft' }), scene({ motion: 'panLeft' })]);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.scenes.map((s) => s.motion)).toEqual(['panLeft', 'panLeft']);
  });

  it('refuses a timeline over the 20 minute cap', () => {
    const many = Array.from({ length: 25 }, () => scene({ durationSeconds: 60 }));
    expect(planTimeline(many)).toContain('cap is 20 minutes');
    expect(MAX_TOTAL_SECONDS).toBe(1200);
  });

  it('refuses out-of-range durations, bad motion and path traversal', () => {
    expect(planTimeline([scene({ durationSeconds: 2 })])).toContain('duration must be');
    expect(planTimeline([scene({ durationSeconds: 90 })])).toContain('duration must be');
    expect(planTimeline([scene({ motion: 'spin' })])).toContain('unsupported motion');
    expect(planTimeline([scene({ stillPath: '../secret.png' })])).toContain('invalid still filename');
    expect(planTimeline([scene({ stillPath: 'a/b.png' })])).toContain('path separator');
    expect(planTimeline([scene({ stillPath: 'notes.txt' })])).toContain('unsupported still file type');
    expect(planTimeline([scene({ audioPath: 'x.exe' })])).toContain('unsupported audio file type');
    expect(planTimeline([])).toBe('timeline is empty');
  });

  it('clamps a dissolve to half of the shorter neighbouring scene', () => {
    const plan = planTimeline([
      scene({ durationSeconds: 5 }),
      scene({ motion: 'zoomOut', durationSeconds: 10, transitionSeconds: 2 }),
    ]);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.scenes[1].transitionSeconds).toBe(2.5 > 2 ? 2 : 2.5);
  });
});
