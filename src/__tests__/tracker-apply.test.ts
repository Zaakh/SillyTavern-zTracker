import {
  applyTrackerUpdateAndRender,
  CHAT_MESSAGE_SCHEMA_HTML_KEY,
  CHAT_MESSAGE_PARTS_META_KEY,
  CHAT_MESSAGE_PENDING_REDACTIONS_KEY,
  CHAT_MESSAGE_SCHEMA_VALUE_KEY,
} from '../tracker.js';
import { EXTENSION_KEY } from '../extension-metadata.js';
import { jest } from '@jest/globals';

describe('applyTrackerUpdateAndRender', () => {
  it('applies tracker fields when render succeeds', () => {
    const message: any = { extra: {} };
    const render = jest.fn();

    applyTrackerUpdateAndRender(message, {
      trackerData: { time: '10:00' },
      trackerHtml: '<div>{{data.time}}</div>',
      render,
    });

    expect(render).toHaveBeenCalledTimes(1);
    expect(message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY]).toEqual({ time: '10:00' });
    expect(message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY]).toBe('<div>{{data.time}}</div>');
  });

  it('rolls back to previous tracker data when render throws', () => {
    const message: any = {
      extra: {
        [EXTENSION_KEY]: {
          [CHAT_MESSAGE_SCHEMA_VALUE_KEY]: { time: 'old' },
          [CHAT_MESSAGE_SCHEMA_HTML_KEY]: '<div>old</div>',
        },
      },
    };

    expect(() =>
      applyTrackerUpdateAndRender(message, {
        trackerData: { time: 'new' },
        trackerHtml: '<div>new</div>',
        render: () => {
          throw new Error('render failed');
        },
      }),
    ).toThrow('render failed');

    expect(message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_VALUE_KEY]).toEqual({ time: 'old' });
    expect(message.extra[EXTENSION_KEY][CHAT_MESSAGE_SCHEMA_HTML_KEY]).toBe('<div>old</div>');
  });

  it('removes tracker data when render throws and there was no prior tracker', () => {
    const message: any = { extra: {} };

    expect(() =>
      applyTrackerUpdateAndRender(message, {
        trackerData: { time: 'new' },
        trackerHtml: '<div>new</div>',
        render: () => {
          throw new Error('render failed');
        },
      }),
    ).toThrow('render failed');

    expect(message.extra[EXTENSION_KEY]).toBeUndefined();
  });

  it('warns when a dependent detail array is missing entries for declared source items', () => {
    const message: any = { extra: {} };
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    applyTrackerUpdateAndRender(message, {
      trackerData: {
        charactersPresent: ['Silvia', 'Tobias'],
        characters: [{ name: 'Silvia', hair: 'Short blonde hair' }],
      },
      trackerHtml: '<div>{{data.charactersPresent.length}}</div>',
      extensionData: {
        [CHAT_MESSAGE_PARTS_META_KEY]: {
          characters: { idKey: 'name', dependsOn: ['charactersPresent'] },
        },
      },
      render: jest.fn(),
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'zTracker: dependent array mismatch',
      expect.objectContaining({
        partKey: 'characters',
        dependsOn: 'charactersPresent',
        idKey: 'name',
        missingIds: ['Tobias'],
      }),
    );
  });

  it('deletes extension data keys when an update explicitly clears them', () => {
    const message: any = {
      extra: {
        [EXTENSION_KEY]: {
          [CHAT_MESSAGE_PENDING_REDACTIONS_KEY]: { version: 1, targets: [{ kind: 'part', partKey: 'time' }] },
        },
      },
    };

    applyTrackerUpdateAndRender(message, {
      trackerData: { time: '10:00' },
      trackerHtml: '<div>{{data.time}}</div>',
      extensionData: {
        [CHAT_MESSAGE_PENDING_REDACTIONS_KEY]: undefined,
      },
      render: jest.fn(),
    });

    expect(message.extra[EXTENSION_KEY][CHAT_MESSAGE_PENDING_REDACTIONS_KEY]).toBeUndefined();
  });
});
