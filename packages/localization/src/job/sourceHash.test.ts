import { describe, expect, it } from 'vitest';
import { computeSourceHash } from './sourceHash';

describe('computeSourceHash', () => {
  it('returns the same hash for the same source and context', () => {
    const first = computeSourceHash({ source: 'Hello', context: 'Button label' });
    const second = computeSourceHash({ source: 'Hello', context: 'Button label' });

    expect(second).toBe(first);
  });

  it('changes when source changes', () => {
    const original = computeSourceHash({ source: 'Hello', context: 'Button label' });
    const changed = computeSourceHash({ source: 'Goodbye', context: 'Button label' });

    expect(changed).not.toBe(original);
  });

  it('changes when context changes', () => {
    const original = computeSourceHash({ source: 'Hello', context: 'Button label' });
    const changed = computeSourceHash({ source: 'Hello', context: 'Dialog title' });

    expect(changed).not.toBe(original);
  });

  it('changes when resume fingerprint changes', () => {
    const original = computeSourceHash({
      source: 'Hello',
      context: 'Button label',
      resumeFingerprint: 'project-1-policy-a',
    });
    const changed = computeSourceHash({
      source: 'Hello',
      context: 'Button label',
      resumeFingerprint: 'project-2-policy-a',
    });

    expect(changed).not.toBe(original);
  });

  it('ignores target text', () => {
    const original = computeSourceHash({
      source: 'Hello',
      context: 'Button label',
      target: 'Bonjour',
    });
    const changedTarget = computeSourceHash({
      source: 'Hello',
      context: 'Button label',
      target: 'Salut',
    });

    expect(changedTarget).toBe(original);
  });
});
