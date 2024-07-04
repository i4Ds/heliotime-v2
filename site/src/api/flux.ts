import { queryOptions } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

export type FluxMeasurement = [timestamp: number, watts: number];
export type FluxSeries = FluxMeasurement[];

export async function fetchFluxSeries(
  resolution: number,
  from?: number,
  to?: number,
  signal?: AbortSignal
): Promise<FluxSeries> {
  const params = new URLSearchParams({
    resolution: resolution.toString(),
  });
  if (from) params.set('start', new Date(Math.floor(from)).toISOString());
  if (to) params.set('end', new Date(Math.ceil(to)).toISOString());
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/flux?${params}`, { signal });
  if (!response.ok) throw new Error(`Fetch failed: ${response}`);
  return response.json();
}

export function selectFlux(series: FluxSeries, start?: number, end?: number): FluxSeries {
  const firstInclusive = series.findIndex(
    ([timestamp]) => start === undefined || start < timestamp
  );
  const lastInclusive = series.findLastIndex(([timestamp]) => end === undefined || timestamp < end);
  return series.slice(firstInclusive, lastInclusive + 1);
}

/**
 * @param ignoreAbort Don't abort if parameters change. Means the placeholder will still be fetched.
 */
export function useFluxQuery(resolution: number, from?: number, to?: number, ignoreAbort = false) {
  const mountTime = useMemo(() => Date.now(), []);
  const isComplete = useCallback(
    (series: FluxSeries) => {
      if (series.length === 0) return false;
      const last = series.at(-1)![0];
      const first = series[0][0];
      const realTo = to ?? mountTime;
      const interval = (realTo - (from ?? first)) / resolution;
      return realTo < last + interval;
    },
    [from, mountTime, resolution, to]
  );
  const [lastData, setLastData] = useState<FluxSeries>([]);
  const placeholderData = useMemo(() => selectFlux(lastData, from, to), [from, lastData, to]);
  return queryOptions({
    queryKey: ['flux', from, to, resolution, ignoreAbort],
    queryFn: async ({ signal }) => {
      const series = await fetchFluxSeries(resolution, from, to, ignoreAbort ? undefined : signal);
      setLastData(series);
      return series;
    },
    // When data is complete only the archive data could slowly catch up so update slower.
    // Else update every minute with the live data.
    staleTime: ({ state }) => (isComplete(state.data ?? []) ? 60 : 10) * 1000,
    refetchInterval: ({ state }) => (isComplete(state.data ?? []) ? 10 : 1) * 60 * 1000,
    gcTime: 10 * 1000,
    placeholderData,
  });
}
