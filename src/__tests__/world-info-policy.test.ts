import { TrackerWorldInfoPolicyMode } from '../config.js';
import {
  formatAllowlistedWorldInfo,
  normalizeWorldInfoName,
  shouldIgnoreWorldInfoDuringTrackerBuild,
} from '../world-info-policy.js';

describe('world info policy', () => {
  test('shouldIgnoreWorldInfoDuringTrackerBuild', () => {
    expect(shouldIgnoreWorldInfoDuringTrackerBuild(TrackerWorldInfoPolicyMode.INCLUDE_ALL)).toBe(false);
    expect(shouldIgnoreWorldInfoDuringTrackerBuild(TrackerWorldInfoPolicyMode.EXCLUDE_ALL)).toBe(true);
    expect(shouldIgnoreWorldInfoDuringTrackerBuild(TrackerWorldInfoPolicyMode.ALLOWLIST)).toBe(true);
  });

  test('normalizeWorldInfoName is case-insensitive', () => {
    expect(normalizeWorldInfoName('  My Book  ')).toBe('my book');
  });

  test('formatAllowlistedWorldInfo includes only allowlisted enabled entries', () => {
    const text = formatAllowlistedWorldInfo({
      allowlistBookNames: ['Book A'],
      allowlistEntryIds: [],
      worldInfos: {
        'Book A': [
          {
            uid: 1,
            key: ['foo'],
            keysecondary: [],
            content: 'A-content',
            comment: '',
            disable: false,
          },
          {
            uid: 2,
            key: ['bar'],
            keysecondary: [],
            content: 'disabled',
            comment: '',
            disable: true,
          },
        ],
        'Book B': [
          {
            uid: 3,
            key: ['baz'],
            keysecondary: [],
            content: 'B-content',
            comment: '',
            disable: false,
          },
        ],
      },
    });

    expect(text).toContain('A-content');
    expect(text).not.toContain('disabled');
    expect(text).not.toContain('B-content');
    expect(text).not.toContain('World Info (allowlisted)');
    expect(text).not.toContain('# Book A');
    expect(text).not.toContain('# Book B');
  });

  test('formatAllowlistedWorldInfo can allowlist by entry id across books', () => {
    const text = formatAllowlistedWorldInfo({
      allowlistBookNames: [],
      allowlistEntryIds: [3],
      worldInfos: {
        'Book A': [
          {
            uid: 1,
            key: ['foo'],
            keysecondary: [],
            content: 'A-content',
            comment: '',
            disable: false,
          },
        ],
        'Book B': [
          {
            uid: 3,
            key: ['baz'],
            keysecondary: [],
            content: 'B-content',
            comment: '',
            disable: false,
          },
        ],
      },
    });

    expect(text).toContain('B-content');
    expect(text).not.toContain('A-content');
    expect(text).not.toContain('# Book B');
    expect(text).not.toContain('# Book A');
  });

  test('formatAllowlistedWorldInfo returns empty string when nothing matches', () => {
    const text = formatAllowlistedWorldInfo({
      allowlistBookNames: ['Missing'],
      allowlistEntryIds: [],
      worldInfos: {
        'Book A': [
          {
            uid: 1,
            key: ['foo'],
            keysecondary: [],
            content: 'A-content',
            comment: '',
            disable: false,
          },
        ],
      },
    });

    expect(text).toBe('');
  });
});
