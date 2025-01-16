import { useEffect, useReducer } from 'react';
import { useWindowEvent } from './window';

function useOnHistoryCall(functionName: 'pushState' | 'replaceState', callback: () => void) {
  useEffect(() => {
    const original = globalThis.history[functionName];
    globalThis.history[functionName] = new Proxy(original, {
      apply: (target, thisArg, argArray) => {
        // Wrap in timeout to call after the history change and prevent a Next.js error.
        setTimeout(() => callback());

        // @ts-expect-error The correctness of argArray is the callers responsibility.
        return target.apply(thisArg, argArray);
      },
    });
    return () => {
      globalThis.history[functionName] = original;
    };
  }, [callback, functionName]);
}

/**
 * Hook to get the current hash/anchor of the URL (part after #).
 */
export function usePathHash(): string | undefined {
  const [hash, update] = useReducer(
    () => globalThis.location.hash.slice(1) as string | undefined,
    undefined
  );
  // Initial update on client-side load.
  useEffect(() => update(), []);
  useWindowEvent('hashchange', update);
  // History.pushState and History.replaceState do not trigger hashchange.
  useOnHistoryCall('pushState', update);
  useOnHistoryCall('replaceState', update);
  return hash;
}
