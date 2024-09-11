import { useVolatileState } from '@/utils/useVolatile';
import { createContext, useCallback, useContext, useMemo } from 'react';

export interface HelioPlayerSettings {
  readonly isFollowing: boolean;
  readonly maximizeWattScale: boolean;
}

// Hardcoded settings
export const FOLLOW_FRONTRUN_PERCENT = 0.1;
export const MIN_FRAME_INTERVAL_MS = 1000 / 30;
export const MIN_VIEW_SIZE_MS = 5 * 60 * 1000;
// Changeable settings
const DEFAULT_SETTINGS: HelioPlayerSettings = {
  isFollowing: true,
  maximizeWattScale: true,
};

export type HelioPlayerSettingsChanger = (change: Partial<HelioPlayerSettings>) => void;
export type HelioPlayerSettingsUse = readonly [
  settings: HelioPlayerSettings,
  changer: HelioPlayerSettingsChanger,
];

export const HelioPlayerSettingsContext = createContext<HelioPlayerSettingsUse>([
  DEFAULT_SETTINGS,
  () => {},
]);

export const usePlayerSettings = () => useContext(HelioPlayerSettingsContext);

export function HelioPlayerSettingsProvider({ children }: React.PropsWithChildren) {
  const [settings, getSetting, setSettings] = useVolatileState(DEFAULT_SETTINGS);
  const changeSettings: HelioPlayerSettingsChanger = useCallback(
    (change) => setSettings({ ...getSetting(), ...change }),
    [getSetting, setSettings]
  );
  const settingsUse = useMemo(
    () => [settings, changeSettings] as const,
    [changeSettings, settings]
  );
  return (
    <HelioPlayerSettingsContext.Provider value={settingsUse}>
      {children}
    </HelioPlayerSettingsContext.Provider>
  );
}
