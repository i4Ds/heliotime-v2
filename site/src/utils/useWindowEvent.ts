import { useEffect, useRef } from 'react';

export type EventListener<EventType extends keyof WindowEventMap> = (
  event: WindowEventMap[EventType]
) => void;

/**
 * Registers an event listener to the global {@link window} object.
 */
export function useWindowEvent<EventType extends keyof WindowEventMap>(
  eventType: EventType,
  callback: EventListener<EventType>
) {
  const savedCallback = useRef<EventListener<EventType>>();
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const listener = (event: WindowEventMap[EventType]) => savedCallback.current?.(event);
    window.addEventListener(eventType, listener);
    return () => window.removeEventListener(eventType, listener);
  }, [eventType]);
}
