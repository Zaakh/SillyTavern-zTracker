// Pins the shared Skip First X Messages guard, including the defensive numeric coercion that
// prevents an undefined/malformed setting from silently skipping every message on the hot path.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ExtensionSettings } from '../config.js';
import { shouldSkipTrackerGeneration } from '../ui/tracker-action-helpers.js';

const settings = (skipFirstXMessages: unknown): ExtensionSettings =>
  ({ skipFirstXMessages } as unknown as ExtensionSettings);

describe('shouldSkipTrackerGeneration', () => {
  const notify = jest.fn();
  afterEach(() => notify.mockClear());

  it('skips messages within a positive threshold', () => {
    expect(shouldSkipTrackerGeneration(0, settings(2), notify, true)).toBe(true);
    expect(shouldSkipTrackerGeneration(1, settings(2), notify, true)).toBe(true);
  });

  it('does not skip at or beyond the threshold', () => {
    expect(shouldSkipTrackerGeneration(2, settings(2), notify, true)).toBe(false);
    expect(shouldSkipTrackerGeneration(5, settings(2), notify, true)).toBe(false);
  });

  it('does not skip when the threshold is zero', () => {
    expect(shouldSkipTrackerGeneration(0, settings(0), notify, true)).toBe(false);
  });

  it('treats undefined/malformed thresholds as no-skip (defensive coercion)', () => {
    expect(shouldSkipTrackerGeneration(0, settings(undefined), notify, true)).toBe(false);
    expect(shouldSkipTrackerGeneration(0, settings('not-a-number'), notify, true)).toBe(false);
  });

  it('notifies only when not silent', () => {
    shouldSkipTrackerGeneration(0, settings(2), notify, false);
    expect(notify).toHaveBeenCalledTimes(1);
    notify.mockClear();
    shouldSkipTrackerGeneration(0, settings(2), notify, true);
    expect(notify).not.toHaveBeenCalled();
  });
});
