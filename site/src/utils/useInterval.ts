import { useEffect, useRef } from 'react';

export function useInterval(intervalMs: number, callback?: (deltaMs: number) => void) {
  const savedCallback = useRef<typeof callback>(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const noCallback = callback === undefined;
  useEffect(() => {
    if (noCallback) return undefined;
    let lastCall = Date.now() - intervalMs;
    const interval = setInterval(() => {
      const now = Date.now();
      savedCallback.current?.(now - lastCall);
      lastCall = now;
    }, intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs, noCallback]);
}
