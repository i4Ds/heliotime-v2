import { parseAsBoolean, useQueryStates } from 'nuqs';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface HelioPlayerSettings {
  readonly isFollowing: boolean;
  readonly lockWattAxis: boolean;
  readonly showPreview: boolean;
  readonly showOverview: boolean;
  readonly linearOverview: boolean;
}

// Hardcoded settings
export const FOLLOW_FRONTRUN_PERCENT = 0.1;
export const MIN_FRAME_INTERVAL_MS = 1000 / 30;
export const MIN_VIEW_SIZE_MS = 5 * 60 * 1000;
// Changeable settings
const DEFAULT_SETTINGS: HelioPlayerSettings = {
  isFollowing: true,
  lockWattAxis: true,
  showPreview: true,
  showOverview: true,
  linearOverview: false,
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
  lockWattAxis: parseAsBoolean.withDefault(DEFAULT_SETTINGS.lockWattAxis),
  showPreview: parseAsBoolean.withDefault(DEFAULT_SETTINGS.showPreview),
  showOverview: parseAsBoolean.withDefault(DEFAULT_SETTINGS.showOverview),
  linearOverview: parseAsBoolean.withDefault(DEFAULT_SETTINGS.linearOverview),
} as const;

function isChangeRedundant(settings: HelioPlayerSettings, change: Partial<HelioPlayerSettings>) {
  return Object.keys(change).every(
    (key) => settings[key as keyof typeof settings] === change[key as keyof typeof change]
  );
}

export function HelioPlayerSettingsProvider({ children }: React.PropsWithChildren) {
  const [querySettings, setQuerySettings] = useQueryStates(SEARCH_PARAMS, { clearOnDefault: true });
  const [settings, setSettings] = useState<HelioPlayerSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...querySettings,
  }));

  // Always sync query with settings as history navigation should not change them.
  useEffect(() => {
    // Skip update if already in sync to avoid infinite loop
    if (isChangeRedundant(settings, querySettings)) return;
    setQuerySettings(settings);
  }, [settings, setQuerySettings, querySettings]);

  const changeSettings: HelioPlayerSettingsChanger = useCallback(
    (change) =>
      setSettings((previous) => {
        if (isChangeRedundant(previous, change)) return previous;
        return { ...previous, ...change };
      }),
    []
  );
  const settingsUse = useMemo(
    () => [settings, changeSettings] as const,
    [settings, changeSettings]
  );
  return (
    <HelioPlayerSettingsContext.Provider value={settingsUse}>
      {children}
    </HelioPlayerSettingsContext.Provider>
  );
}
