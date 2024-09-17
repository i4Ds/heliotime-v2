import { parseAsBoolean, useQueryStates } from 'nuqs';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface HelioPlayerSettings {
  readonly isFollowing: boolean;
  readonly lockWattAxis: boolean;
}

// Hardcoded settings
export const FOLLOW_FRONTRUN_PERCENT = 0.1;
export const MIN_FRAME_INTERVAL_MS = 1000 / 30;
export const MIN_VIEW_SIZE_MS = 5 * 60 * 1000;
// Changeable settings
const DEFAULT_SETTINGS: HelioPlayerSettings = {
  isFollowing: true,
  lockWattAxis: true,
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

const SEARCH_PARAMS = {
  lockWattAxis: parseAsBoolean.withDefault(true),
} as const;

export function HelioPlayerSettingsProvider({ children }: React.PropsWithChildren) {
  const [querySettings, setQuerySettings] = useQueryStates(SEARCH_PARAMS, { clearOnDefault: true });
  const [sessionSettings, setSessionSettings] = useState<HelioPlayerSettings>(DEFAULT_SETTINGS);
  const changeSettings: HelioPlayerSettingsChanger = useCallback(
    (change) => {
      setQuerySettings(change);
      setSessionSettings((previous) => ({ ...previous, ...change }));
    },
    [setQuerySettings]
  );
  const settingsUse = useMemo(
    () => [{ ...sessionSettings, ...querySettings }, changeSettings] as const,
    [changeSettings, querySettings, sessionSettings]
  );
  return (
    <HelioPlayerSettingsContext.Provider value={settingsUse}>
      {children}
    </HelioPlayerSettingsContext.Provider>
  );
}
