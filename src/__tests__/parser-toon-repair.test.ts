// Chat-like TOON repair tests that cover both recoverable and non-recoverable tracker replies.

import { describe, expect, it, jest } from '@jest/globals';
import { parseResponse } from '../parser.js';
import {
  barTrackerExpected,
  damagedToonReplyFromBarChat,
  invalidToonJsonFenceFromSmokeTest,
  sceneTrackerSchema,
} from '../test-fixtures/parser-repair-fixtures.js';

describe('parseResponse TOON repair fixtures', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('repairs a chat-like TOON tracker reply when tables lose tab delimiters', () => {
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = parseResponse(damagedToonReplyFromBarChat, 'toon', { schema: sceneTrackerSchema });

    expect(result).toEqual(barTrackerExpected);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      'zTracker: repaired TOON response',
      expect.objectContaining({
        appliedSteps: expect.arrayContaining(['fence cleanup', 'tabular delimiter normalization']),
      }),
    );
  });

  it('rejects the real smoke-test failure where JSON is wrapped in a toon fence', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    try {
      expect(() => parseResponse(invalidToonJsonFenceFromSmokeTest, 'toon', { schema: sceneTrackerSchema })).toThrow(
        'Model response is not valid TOON.',
      );
      expect(consoleInfoSpy).not.toHaveBeenCalledWith('zTracker: repaired TOON response', expect.anything());
    } finally {
      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    }
  });
});