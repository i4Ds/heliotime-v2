import { useCallback, useRef, useState } from 'react';

/**
 * Like {@link useState} but the changes are directly reflected in the getter
 * instead of having to wait for the next render call.
 *
 * Value is only synced with original provided value when `sync()` is called.
 *
 * @returns `[get(), set(value), sync()]` tuple
 */
export function useVolatile<Value>(
  value: Value,
  setter: ((value: Value) => void) | undefined = undefined
): [get: () => Value, set: (value: Value) => void, sync: () => void] {
  const volatile = useRef(value);
  return [
    useCallback(() => volatile.current, []),
    useCallback(
      (newValue) => {
        volatile.current = newValue;
        setter?.(newValue);
      },
      [setter]
    ),
    useCallback(() => {
      volatile.current = value;
    }, [value]),
  ];
}

/**
 * Like {@link useVolatile} but holds state internally making syncing redundant.
 *
 * @returns `[value, getVolatile(), set(value)]` tuple with first being the rendered value.
 */
export function useVolatileState<Value = undefined>(): [
  value: Value | undefined,
  get: () => Value | undefined,
  set: (value: Value | undefined) => void,
];
export function useVolatileState<Value>(
  initial: Value | (() => Value)
): [value: Value, get: () => Value, set: (value: Value) => void];
export function useVolatileState<Value>(
  initial: Value | (() => Value) = undefined as Value
): [value: Value, get: () => Value, set: (value: Value) => void] {
  const [value, setValue] = useState(initial);
  const [volatile, setVolatile] = useVolatile(value, setValue);
  return [value, volatile, setVolatile];
}
