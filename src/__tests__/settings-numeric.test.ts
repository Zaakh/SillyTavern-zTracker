/**
 * @jest-environment node
 */

import { sanitizeIntegerSetting } from '../settings-numeric.js';

describe('sanitizeIntegerSetting', () => {
  test('clamps values below the configured minimum', () => {
    expect(sanitizeIntegerSetting('-5', { fallback: 0, min: 0 })).toBe(0);
    expect(sanitizeIntegerSetting('0', { fallback: 1, min: 1 })).toBe(1);
  });

  test('falls back when the input is not a valid integer', () => {
    expect(sanitizeIntegerSetting('', { fallback: 7, min: 0 })).toBe(7);
    expect(sanitizeIntegerSetting('NaN', { fallback: 3, min: 0 })).toBe(3);
  });

  test('preserves valid integer values', () => {
    expect(sanitizeIntegerSetting('42', { fallback: 1, min: 1 })).toBe(42);
  });
});
