/**
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import {
  createHostWorldInfoScopeDeps,
  getWorldInfoRowScopeStatus,
  hasScopedRows,
  isWorldInfoRowScopeSatisfied,
  resolveWorldInfoScopeSources,
} from '../world-info-scope.js';

const row = (book: string, activeVia: any[] = []) => ({ book, activeVia, entryIds: [], trigger: 'always' as const });

function makeDeps(overrides: any = {}) {
  return {
    context: {
      chatId: 'chat-1',
      chatMetadata: {},
      characters: [
        { avatar: 'a.png', data: { extensions: { world: 'Primary A' } } },
        { avatar: 'b.png', data: { extensions: {} } },
      ],
      characterId: 0,
      groups: [],
      ...overrides.context,
    },
    getGlobalBookNames: overrides.getGlobalBookNames ?? (async () => ['Global One']),
    getExtraCardBooks: overrides.getExtraCardBooks ?? (async (avatar: string) => (avatar === 'a.png' ? ['Extra A'] : [])),
  };
}

describe('isWorldInfoRowScopeSatisfied', () => {
  const sources = {
    cardBooks: new Set(['card book']),
    globalBooks: new Set(['global book']),
    chatOpen: true,
    cardLookupComplete: true,
  };

  test('always, card, global and either-source rows, case-insensitively', () => {
    expect(isWorldInfoRowScopeSatisfied(row('Nowhere'), sources)).toBe(true);
    expect(isWorldInfoRowScopeSatisfied(row('CARD book', ['card']), sources)).toBe(true);
    expect(isWorldInfoRowScopeSatisfied(row('Global Book', ['global']), sources)).toBe(true);
    expect(isWorldInfoRowScopeSatisfied(row('Global Book', ['card']), sources)).toBe(false);
    expect(isWorldInfoRowScopeSatisfied(row('Global Book', ['card', 'global']), sources)).toBe(true);
    expect(isWorldInfoRowScopeSatisfied(row('Nowhere', ['card', 'global']), sources)).toBe(false);
  });
});

describe('hasScopedRows', () => {
  test('is true only when some row has a scope', () => {
    expect(hasScopedRows([row('A'), row('B')])).toBe(false);
    expect(hasScopedRows([row('A'), row('B', ['card'])])).toBe(true);
  });
});

describe('resolveWorldInfoScopeSources', () => {
  test('single chat: primary + extra books, chat-bound book and global names', async () => {
    const sources = await resolveWorldInfoScopeSources(makeDeps({ context: { chatMetadata: { world_info: 'Chat Book' } } }));
    expect([...sources.cardBooks].sort()).toEqual(['chat book', 'extra a', 'primary a']);
    expect([...sources.globalBooks]).toEqual(['global one']);
    expect(sources).toMatchObject({ chatOpen: true, cardLookupComplete: true });
  });

  test('card index 0 is honored (no falsy-index skip)', async () => {
    const sources = await resolveWorldInfoScopeSources(makeDeps({ context: { characterId: 0 } }));
    expect(sources.cardBooks.has('primary a')).toBe(true);
  });

  test('group chat uses every member card', async () => {
    const getExtraCardBooks = jest.fn(async (avatar: string) => (avatar === 'b.png' ? ['Extra B'] : []));
    const sources = await resolveWorldInfoScopeSources(
      makeDeps({
        context: { groupId: 'g1', groups: [{ id: 'g1', members: ['a.png', 'b.png', 'missing.png'] }] },
        getExtraCardBooks,
      }),
    );
    expect([...sources.cardBooks].sort()).toEqual(['extra b', 'primary a']);
    expect(getExtraCardBooks).toHaveBeenCalledTimes(2);
  });

  test('no chat open is reported', async () => {
    const sources = await resolveWorldInfoScopeSources(makeDeps({ context: { chatId: undefined } }));
    expect(sources.chatOpen).toBe(false);
  });

  test('extras lookup failure fails closed but keeps the primary book', async () => {
    const sources = await resolveWorldInfoScopeSources(
      makeDeps({
        getExtraCardBooks: async () => {
          throw new Error('boom');
        },
      }),
    );
    expect(sources.cardLookupComplete).toBe(false);
    expect(isWorldInfoRowScopeSatisfied(row('Primary A', ['card']), sources)).toBe(true);
    expect(isWorldInfoRowScopeSatisfied(row('Extra A', ['card']), sources)).toBe(false);
  });

  test('skips host lookups for scopes that no row uses', async () => {
    const deps = makeDeps();
    const getGlobalBookNames = jest.fn(deps.getGlobalBookNames);
    const getExtraCardBooks = jest.fn(deps.getExtraCardBooks);
    await resolveWorldInfoScopeSources({ ...deps, getGlobalBookNames, getExtraCardBooks }, { card: false, global: false });
    expect(getGlobalBookNames).not.toHaveBeenCalled();
    expect(getExtraCardBooks).not.toHaveBeenCalled();
  });
});

describe('createHostWorldInfoScopeDeps', () => {
  test('parses the /getcharbook pipe value as a book-name array', async () => {
    const executeSlashCommandsWithOptions = jest.fn(async () => ({ pipe: '["X","Y",3]' }));
    const deps = createHostWorldInfoScopeDeps({ executeSlashCommandsWithOptions }, async () => []);
    await expect(deps.getExtraCardBooks('a.png')).resolves.toEqual(['X', 'Y']);
    expect(executeSlashCommandsWithOptions).toHaveBeenCalledWith('/getcharbook type=all "a.png"', { handleParserErrors: false });
  });
});

describe('getWorldInfoRowScopeStatus', () => {
  const base = { cardBooks: new Set(['card book']), globalBooks: new Set<string>(), chatOpen: true, cardLookupComplete: true };

  test('maps always/satisfied to ok and unsatisfied to skipped', () => {
    expect(getWorldInfoRowScopeStatus(row('X'), base)).toBe('ok');
    expect(getWorldInfoRowScopeStatus(row('Card Book', ['card']), base)).toBe('ok');
    expect(getWorldInfoRowScopeStatus(row('Other', ['card']), base)).toBe('skipped');
  });

  test('no open chat or an incomplete card lookup is unknown, but an always row stays ok', () => {
    expect(getWorldInfoRowScopeStatus(row('Other', ['card']), { ...base, chatOpen: false })).toBe('unknown');
    expect(getWorldInfoRowScopeStatus(row('X'), { ...base, chatOpen: false })).toBe('ok');
    expect(getWorldInfoRowScopeStatus(row('Other', ['card']), { ...base, cardLookupComplete: false })).toBe('unknown');
    expect(getWorldInfoRowScopeStatus(row('Other', ['global']), { ...base, cardLookupComplete: false })).toBe('skipped');
  });
});
