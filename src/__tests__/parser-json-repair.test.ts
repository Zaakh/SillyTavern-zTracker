// Chat-like JSON repair tests that exercise parser recovery on realistic tracker replies.

import { describe, expect, it, jest } from '@jest/globals';
import { parseResponse } from '../parser.js';
import { barTrackerExpected, damagedJsonReplyFromBarChat } from '../test-fixtures/parser-repair-fixtures.js';

describe('parseResponse JSON repair fixtures', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('repairs a chat-like JSON tracker reply with prose, smart quotes, and trailing commas', () => {
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = parseResponse(damagedJsonReplyFromBarChat, 'json');

    expect(result).toEqual(barTrackerExpected);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'zTracker: repaired JSON response',
      expect.objectContaining({
        appliedSteps: expect.arrayContaining([
          'json substring extraction',
          'smart quote normalization',
          'trailing comma removal',
        ]),
      }),
    );
  });
});