import { createContext, useContext, useMemo, useState } from 'react';
import { useInterval } from '@/utils/useInterval';
import { panView } from '@/utils/panZoom';
import { useWindowEvent } from '@/utils/window';
import { MIN_FRAME_INTERVAL_MS } from './settings';
import { usePlayerState } from './state';

export interface HelioPlayerPanControl {
  start(forward: boolean): void;
  stop(): void;
}

export const HelioPlayerPanContext = createContext<HelioPlayerPanControl>({
  start: () => {},
  stop: () => {},
});

export const usePanControl = () => useContext(HelioPlayerPanContext);

const PAN_SPEED = 0.4;

export function HelioPlayerPanProvider({ children }: React.PropsWithChildren) {
  const state = usePlayerState();

  const [panSpeed, setPanSpeed] = useState(0);
  const control = useMemo<HelioPlayerPanControl>(
    () => ({
      start: (forward) => setPanSpeed(forward ? PAN_SPEED : -PAN_SPEED),
      stop: () => setPanSpeed(0),
    }),
    []
  );

  // Drive pan motion
  useInterval(
    MIN_FRAME_INTERVAL_MS,
    panSpeed === 0
      ? undefined
      : (deltaMs) => {
          const view = state.view();
          state.setView(panView(view, (view[1] - view[0]) * panSpeed * (deltaMs / 1000)));
        }
  );

  // Keyboard-based panning
  useWindowEvent('keydown', (event) => {
    if (event.key === 'ArrowRight') control.start(true);
    if (event.key === 'ArrowLeft') control.start(false);
  });
  useWindowEvent('keyup', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') control.stop();
  });

  return (
    <HelioPlayerPanContext.Provider value={control}>{children}</HelioPlayerPanContext.Provider>
  );
}
