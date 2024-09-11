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

/**
 * Like {@link useVolatile} but will automatically sync to {@link value} on each render.
 *
 * To avoid synced to an old value, it will ignore changes for {@link waitMs} milliseconds
 * after a change through the volatile setter.
 *
 * @returns `[get(), set(value), sync()]` tuple
 */
export function useVolatileSynced<Value>(
  value: Value,
  setter: ((value: Value) => void) | undefined = undefined,
  waitMs = 100
): [get: () => Value, set: (value: Value) => void, sync: () => void] {
  const [get, setInternal, sync] = useVolatile(value, setter);

  const lastChange = useRef(0);
  const set = useCallback(
    (newValue: Value) => {
      lastChange.current = Date.now();
      setInternal(newValue);
    },
    [setInternal]
  );
  if (get() !== value && lastChange.current < Date.now() - waitMs) sync();
  return [get, set, sync];
}
