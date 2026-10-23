/** Shared elapsed-time helpers for run-progress feedback (m:ss format and a drift-free one-second ticker). */

/** Formats milliseconds as minutes and seconds, e.g. 83000 -> "1:23". */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  return `${Math.floor(totalSeconds / 60)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Calls `onTick(elapsedMs)` once per second until the returned `stop()` is called.
 * Elapsed time comes from the wall clock, not from counting ticks, because background tabs throttle intervals.
 * `startedAt` lets a re-attached badge continue an existing run's clock.
 */
export function startRunTimer(onTick: (elapsedMs: number) => void, startedAt: number = Date.now()): () => void {
  const id = setInterval(() => onTick(Date.now() - startedAt), 1000);
  return () => clearInterval(id);
}
