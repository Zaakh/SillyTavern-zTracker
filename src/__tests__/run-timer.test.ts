import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { formatElapsed, startRunTimer } from '../run-timer.js';

describe('formatElapsed', () => {
  it('formats m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59_999)).toBe('0:59');
    expect(formatElapsed(83_000)).toBe('1:23');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('startRunTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('ticks once per second with wall-clock elapsed time', () => {
    const onTick = jest.fn();
    startRunTimer(onTick);
    jest.advanceTimersByTime(3000);
    expect(onTick.mock.calls).toEqual([[1000], [2000], [3000]]);
  });

  it('catches up from the clock after a skipped tick', () => {
    const onTick = jest.fn();
    startRunTimer(onTick);
    // Throttled tab: the clock jumps 10s but only one interval callback fires.
    jest.setSystemTime(10_000);
    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenLastCalledWith(11_000);
  });

  it('continues from a supplied start time', () => {
    const onTick = jest.fn();
    jest.setSystemTime(40_000);
    startRunTimer(onTick, 0);
    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledWith(41_000);
  });

  it('does not tick after stop()', () => {
    const onTick = jest.fn();
    const stop = startRunTimer(onTick);
    jest.advanceTimersByTime(1000);
    stop();
    jest.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });
});
