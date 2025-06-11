import { useState } from 'react';
import { useEffect } from 'react';
import { useEvent } from './useEvent';

export type EventListener<EventType extends keyof WindowEventMap> = (
  event: WindowEventMap[EventType]
) => void;

/**
 * Registers an event listener to the global {@link window} object.
 */
export function useWindowEvent<EventType extends keyof WindowEventMap>(
  eventType: EventType,
  callback: EventListener<EventType>,
  passive: boolean = true
) {
  useEvent(
    // eslint-disable-next-line unicorn/prefer-global-this
    typeof window === 'undefined' ? undefined : window,
    // @ts-expect-error EventType is a key of WindowEventMap and should be valid.
    eventType,
    callback,
    passive
  );
}

interface Size {
  width: number;
  height: number;
}

export function useWindowSize(): Size {
  const [size, setSize] = useState(() =>
    // eslint-disable-next-line unicorn/prefer-global-this
    typeof window === 'undefined'
      ? {
          width: 0,
          height: 0,
        }
      : {
          width: window.innerWidth,
          height: window.innerHeight,
        }
  );
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);
  return size;
}
