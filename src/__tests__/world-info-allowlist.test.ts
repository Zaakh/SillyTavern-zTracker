import { buildAllowlistedWorldInfoText } from '../world-info-allowlist.js';

describe('world info allowlist builder', () => {
  test('includes allowlisted lorebook content fetched by name', async () => {
    const text = await buildAllowlistedWorldInfoText({
      allowlistBookNames: ['The Bar'],
      allowlistEntryIds: [],
      getActiveWorldInfos: async () => ({}),
      loadBookByName: async (name) => {
        if (name !== 'The Bar') return null;
        return {
          name: 'The Bar',
          entries: [
            { uid: 10, key: ['bar'], content: 'Bar-content', comment: '', disable: false },
            { uid: 11, key: ['bar'], content: 'Disabled', comment: '', disable: true },
          ],
        };
      },
    });

    expect(text).toContain('Bar-content');
    expect(text).not.toContain('Disabled');
    expect(text).not.toContain('World Info (allowlisted)');
    expect(text).not.toContain('# The Bar');
  });

  test('merges fetched books with active world infos without duplicate uids', async () => {
    const text = await buildAllowlistedWorldInfoText({
      allowlistBookNames: ['Book A'],
      allowlistEntryIds: [],
      getActiveWorldInfos: async () => ({
        'Book A': [{ uid: 1, key: ['a'], content: 'A1', comment: '', disable: false }],
      }),
      loadBookByName: async () => ({
        name: 'Book A',
        entries: [
          { uid: 1, key: ['a'], content: 'A1-duplicate', comment: '', disable: false },
          { uid: 2, key: ['a'], content: 'A2', comment: '', disable: false },
        ],
      }),
    });

    expect(text).toContain('A1');
    expect(text).toContain('A2');
    expect(text).not.toContain('A1-duplicate');
    expect(text).not.toContain('# Book A');
  });
});
