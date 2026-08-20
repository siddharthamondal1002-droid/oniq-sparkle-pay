import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('story CV fixture manifest gate', () => {
  it('validates the blocked/ready fixture manifest policy in CI mode', () => {
    const out = execFileSync('node', ['remotion/scripts/story-cv-fixtures-validate.mjs', '--ci'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    expect(out).toContain('"status": "BLOCKED"');
  });
});
