// Chat-like XML repair tests that exercise parser recovery on realistic tracker replies.

import { describe, expect, it, jest } from '@jest/globals';
import { parseResponse } from '../parser.js';
import { barTrackerExpected, damagedXmlReplyFromBarChat, sceneTrackerSchema } from '../test-fixtures/parser-repair-fixtures.js';

describe('parseResponse XML repair fixtures', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('repairs a chat-like XML tracker reply wrapped in surrounding prose', () => {
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = parseResponse(damagedXmlReplyFromBarChat, 'xml', { schema: sceneTrackerSchema });

    expect(result).toEqual(barTrackerExpected);
    expect(consoleInfoSpy).not.toHaveBeenCalledWith('zTracker: XML repair failed', expect.anything());
  });
});