import { fluxRangeQueryOptions } from '@/api/flux/useFluxRange';
import { limitView, panView } from '@/utils/panZoom';
import { NumberRange } from '@/utils/range';
import { useInterval } from '@/utils/useInterval';
import { useVolatileState } from '@/utils/useVolatile';
import { useQuery } from '@tanstack/react-query';
import { createParser, HistoryOptions, parseAsIsoDateTime, useQueryStates } from 'nuqs';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { expFloor } from '@/utils/math';
import {
  FOLLOW_FRONTRUN_PERCENT,
  MIN_FRAME_INTERVAL_MS,
  MIN_VIEW_SIZE_MS,
  usePlayerSettings,
} from './settings';

export type Timestamp = number;
export type View = Readonly<NumberRange>;

export interface HelioPlayerRenderState {
  readonly timestamp: Timestamp;
  readonly view: View;
  readonly range: View;
}

export interface HelioPlayerState {
  timestamp(): Timestamp;
  setTimestamp(timestamp: Timestamp): void;
  view(): View;
  setView(view: View): void;
  setFollowView(viewSize: number): void;
  range(): View;
  commitToHistory(): void;
}

const DEFAULT_VIEW_SIZE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STATE: HelioPlayerRenderState = {
  timestamp: 0,
  view: [0, 0],
  range: [0, 0],
};

export const HelioPlayerRenderStateContext = createContext<HelioPlayerRenderState>(DEFAULT_STATE);
export const HelioPlayerStateContext = createContext<HelioPlayerState>({
  timestamp: () => DEFAULT_STATE.timestamp,
  setTimestamp: () => {},
  view: () => DEFAULT_STATE.view,
  setView: () => {},
  setFollowView: () => {},
  range: () => DEFAULT_STATE.range,
  commitToHistory: () => {},
});

export const usePlayerRenderState = () => useContext(HelioPlayerRenderStateContext);
export const usePlayerState = () => useContext(HelioPlayerStateContext);

export const parseAsView = createParser<View>({
  parse(value) {
    const [start, end] = value.split('~').map((v) => Date.parse(v));
    // eslint-disable-next-line unicorn/no-null
    if (!Number.isFinite(start)) return null;
    return [start, Number.isFinite(end) ? end : start + DEFAULT_VIEW_SIZE_MS];
  },
  serialize(view) {
    return view.map((date) => new Date(date).toISOString()).join('~');
  },
});

export const parseAsIsoTimestamp = createParser<Timestamp>({
  // eslint-disable-next-line unicorn/no-null
  parse: (value) => parseAsIsoDateTime.parse(value)?.getTime() ?? null,
  serialize: (timestamp) => parseAsIsoDateTime.serialize(new Date(timestamp)),
});

function useSyncOnChange<Value>(syncValue: Value, setter: (value: Value) => void) {
  const lastValue = useRef(syncValue);
  useEffect(() => {
    if (lastValue.current === syncValue) return;
    lastValue.current = syncValue;
    setter(syncValue);
  }, [lastValue, setter, syncValue]);
}

const SEARCH_PARAMS = {
  date: parseAsIsoTimestamp.withDefault(DEFAULT_STATE.timestamp),
  view: parseAsView.withDefault(DEFAULT_STATE.view),
} as const;

interface HelioPlayerStateProviderProps {
  chartWidth: number;
  children: React.ReactNode;
}

export function HelioPlayerStateProvider({ chartWidth, children }: HelioPlayerStateProviderProps) {
  const [settings, changeSettings] = usePlayerSettings();
  const [{ date: historyTimestamp, view: historyView }, setQueryState] =
    useQueryStates(SEARCH_PARAMS);
  const [renderRange, getRange, setRange] = useVolatileState(DEFAULT_STATE.range);

  // Timestamp state
  const [renderTimestamp, getTimestamp, setInternalTimestamp] = useVolatileState(historyTimestamp);
  const setTimestamp = useCallback(
    (rawTimestamp: Timestamp) => {
      const range = getRange();
      const timestamp = Math.min(Math.max(rawTimestamp, range[0]), range[1]);
      setInternalTimestamp(timestamp);
    },
    [getRange, setInternalTimestamp]
  );
  useSyncOnChange(historyTimestamp, setTimestamp);

  // View state
  const [renderView, getView, setInternalView] = useVolatileState(historyView);
  const setView = useCallback(
    (rawView: View) => {
      const range = getRange();
      const overflow = Math.min(rawView[1] - rawView[0], range[1] - range[0]) * 0.9;
      const newView = limitView(
        rawView,
        [range[0] - overflow, range[1] + overflow],
        MIN_VIEW_SIZE_MS
      );

      const oldView = getView();
      // If view moved out of live part
      if (newView[1] < range[1]) changeSettings({ isFollowing: false });
      // If view newly moved into live part (only newly to allow disabling following)
      if (oldView[1] < range[1] && newView[1] > range[1]) changeSettings({ isFollowing: true });

      setInternalView(newView);
    },
    [changeSettings, getRange, getView, setInternalView]
  );
  useSyncOnChange(historyView, setView);
  const setFollowView = useCallback(
    (viewSize: number) => {
      const frontrun = Date.now() + FOLLOW_FRONTRUN_PERCENT * viewSize;
      setView([frontrun - viewSize, frontrun]);
    },
    [setView]
  );

  const commitToHistory = useCallback(
    (history: HistoryOptions = 'push') => {
      setQueryState({ date: Math.round(getTimestamp()) }, { history });
      const view = getView();
      setQueryState({ view: [Math.round(view[0]), Math.round(view[1])] }, { history });
    },
    [getTimestamp, getView, setQueryState]
  );

  // Initialize state
  // Must be within an useEffect to avoid SSR mismatches.
  useEffect(() => {
    const now = Date.now();
    // Set to max range if not yet loaded. (GOES-1 was launched in 1975)
    if (getRange() === DEFAULT_STATE.range) setRange([0, now]);
    const isViewDefault = getView() === DEFAULT_STATE.view;
    if (getTimestamp() === DEFAULT_STATE.timestamp)
      setTimestamp(isViewDefault ? now : (getView()[0] + getView()[1]) / 2);
    // Set to last day by default.
    if (isViewDefault) setFollowView(24 * 60 * 60 * 1000);
    commitToHistory('replace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow live time
  // Reduce refresh rate when zoomed out
  // eslint-disable-next-line unicorn/prefer-global-this
  const pixelRatio = typeof window === 'object' ? window.devicePixelRatio : 1;
  const liveRelevantView = settings.isFollowing ? renderView : renderRange;
  const liveIntervalsMs = Math.max(
    MIN_FRAME_INTERVAL_MS,
    chartWidth === 0
      ? 0
      : expFloor((liveRelevantView[1] - liveRelevantView[0]) / chartWidth / pixelRatio, 1.2)
  );
  useInterval(liveIntervalsMs, (deltaMs) => {
    setRange([getRange()[0], Date.now()]);
    if (settings.isFollowing) setView(panView(getView(), deltaMs));
  });

  // Update start with server reported date
  const { data: dataRange } = useQuery(fluxRangeQueryOptions());
  useEffect(() => {
    if (dataRange === undefined) return;
    setRange([dataRange[0], Date.now()]);
    // Reapply limits to view in case range got smaller
    setView(getView());
  }, [dataRange, getRange, getView, setView, setRange]);

  const renderState = useMemo(
    () => ({
      timestamp: renderTimestamp,
      view: renderView,
      range: renderRange,
    }),
    [renderRange, renderTimestamp, renderView]
  );
  const state = useMemo(
    () => ({
      timestamp: getTimestamp,
      setTimestamp,
      view: getView,
      setView,
      setFollowView,
      range: getRange,
      commitToHistory,
    }),
    [commitToHistory, getRange, getTimestamp, getView, setFollowView, setTimestamp, setView]
  );

  return (
    <HelioPlayerStateContext.Provider value={state}>
      <HelioPlayerRenderStateContext.Provider value={renderState}>
        {children}
      </HelioPlayerRenderStateContext.Provider>
    </HelioPlayerStateContext.Provider>
  );
}
