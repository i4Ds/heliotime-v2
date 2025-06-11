import { useEffect, useRef } from 'react';

export type EventListener<TEvent extends Event> = (event: TEvent) => void;

type EventFromType<EventType extends string> = EventType extends keyof GlobalEventHandlersEventMap
  ? GlobalEventHandlersEventMap[EventType]
  : Event;

/**
 * Registers an event listener to the target.
 * Allows for non-passive listeners.
 */
export function useEvent<
  Target extends EventTarget,
  EventType extends keyof GlobalEventHandlersEventMap,
>(
  target: Target | null | undefined,
  eventType: EventType,
  callback: EventListener<EventFromType<EventType>>,
  passive: boolean = true
) {
  const savedCallback = useRef<EventListener<EventFromType<EventType>>>(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (target === null || target === undefined) return undefined;
    const listener = (event: EventFromType<EventType>) => savedCallback.current(event);
    // @ts-expect-error Listener type should match the event type.
    target.addEventListener(eventType, listener, { passive });
    // @ts-expect-error Listener type should match the event type.
    return () => target.removeEventListener(eventType, listener);
  }, [eventType, passive, target]);
}
