import { useEffect, useRef } from 'react';
import { expFloor } from './math';

export function useInterval(intervalMs: number, callback?: (deltaMs: number) => void) {
  const savedCallback = useRef<typeof callback>(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const noCallback = callback === undefined;
  // Stabilize to not recreate the interval too often
  const stableIntervalMs = expFloor(intervalMs, 1.2);
  useEffect(() => {
    if (noCallback) return undefined;
    let lastCall = Date.now() - stableIntervalMs;
    const interval = setInterval(() => {
      const now = Date.now();
      savedCallback.current?.(now - lastCall);
      lastCall = now;
    }, stableIntervalMs);
    return () => clearInterval(interval);
  }, [noCallback, stableIntervalMs]);
}
