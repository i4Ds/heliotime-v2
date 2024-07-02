import { queryOptions } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

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

function select(series: FluxSeries, start?: number, end?: number): FluxSeries {
  const firstInclusive = series.findIndex(
    ([timestamp]) => start === undefined || start < timestamp
  );
  const lastInclusive = series.findLastIndex(([timestamp]) => end === undefined || timestamp < end);
  return series.slice(firstInclusive, lastInclusive + 1);
}

let lastFetch: FluxSeries = [];

export function useFluxQuery(resolution: number, from?: number, to?: number) {
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
  const placeholderData = useMemo(() => select(lastFetch, from, to), [from, to]);
  return queryOptions({
    queryKey: ['flux', from, to, resolution],
    queryFn: async ({ signal }) => {
      const series = await fetchFluxSeries(resolution, from, to, signal);
      lastFetch = series;
      return series;
    },
    staleTime: ({ state }) => (isComplete(state.data ?? []) ? Number.POSITIVE_INFINITY : 0),
    // Live data source updates every minute
    refetchInterval: ({ state }) => (isComplete(state.data ?? []) ? false : 60 * 1000),
    placeholderData,
  });
}
