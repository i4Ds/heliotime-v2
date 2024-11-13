import { useState } from 'react';
import { useEffect, useRef } from 'react';

export type EventListener<EventType extends keyof WindowEventMap> = (
  event: WindowEventMap[EventType]
) => void;

/**
 * Registers an event listener to the global {@link window} object.
 */
export function useWindowEvent<EventType extends keyof WindowEventMap>(
  eventType: EventType,
  callback: EventListener<EventType>,
  options?: AddEventListenerOptions
) {
  const savedCallback = useRef<EventListener<EventType>>(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const listener = (event: WindowEventMap[EventType]) => savedCallback.current(event);
    globalThis.addEventListener(eventType, listener, options);
    return () => globalThis.removeEventListener(eventType, listener);
  }, [eventType, options]);
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
