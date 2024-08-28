import { splitByDelta } from '@/utils/array';
import { expCeil, resCeil, resFloor } from '@/utils/math';
import { NumberRange } from '@/utils/range';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { useDebounce } from 'use-debounce';

export type FluxMeasurement = [timestamp: number, watts: number];
export type FluxSeries = FluxMeasurement[];
export type FluxSections = FluxSeries[];

export async function fetchFluxRange(signal?: AbortSignal): Promise<NumberRange> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/status`, { signal });
  if (!response.ok) throw new Error(`Fetch failed: ${response}`);
  const json = await response.json();
  return [new Date(json.start).getTime(), new Date(json.end).getTime()];
}

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
  const json: FluxSeries = await response.json();
  // Clamp min value because below 1e-9 we run into floating point issues
  return json.map(([timestamp, watt]) => [timestamp, Math.max(watt, 1e-9)]);
}

export function selectFlux(series: FluxSeries, start?: number, end?: number): FluxSeries {
  const firstInclusive = start && series.findIndex(([timestamp]) => start < timestamp);
  const lastExclusive = end && series.findLastIndex(([timestamp]) => timestamp < end) + 1;
  if (firstInclusive === -1 || lastExclusive === -1) return [];
  return series.slice(firstInclusive, lastExclusive);
}

export function selectFluxSections(
  sections: FluxSections,
  start?: number,
  end?: number
): FluxSections {
  const firstInclusive = start && sections.findIndex((section) => start < section.at(-1)![0]);
  const lastExclusive = end && sections.findLastIndex((section) => section[0][0] < end) + 1;
  if (firstInclusive === -1 || lastExclusive === -1) return [];
  const filteredSections = sections.slice(firstInclusive, lastExclusive);
  return filteredSections.map((section, index) =>
    // Only first and last section needs to be clipped
    index !== 0 && index !== filteredSections.length ? section : selectFlux(section, start, end)
  );
}

export function useFluxRangeQuery() {
  return queryOptions({
    queryKey: ['flux-range'],
    queryFn: ({ signal }) => fetchFluxRange(signal),
  });
}

/**
 * If the fetched data has data up until the end,
 * meaning at least the live data has fully caught up.
 */
function isLiveComplete(sections: FluxSections | undefined, to: number): boolean {
  const series = sections?.at(-1);
  if (series === undefined || series.length < 2) return false;
  const last = series.at(-1)![0];
  const lastInterval = last - series.at(-2)![0];
  return to < last + lastInterval;
}

const MAX_INTERVALS_SKIPPED = 3;
const MIN_ALLOWED_DELTA_MS = 60 * 1000;

function splitByHole(series: FluxSeries, intervalMs: number): FluxSections {
  const maxDelta = Math.max(MIN_ALLOWED_DELTA_MS, MAX_INTERVALS_SKIPPED * intervalMs);
  return splitByDelta(series, (d) => d[0], maxDelta);
}

export function fluxQueryOptions(from: number, to: number, resolution: number) {
  return queryOptions({
    queryKey: ['flux', from, to, resolution],
    queryFn: async () =>
      splitByHole(await fetchFluxSeries(resolution, from, to), (to - from) / resolution),
    // When data is live complete only the archive data could slowly catch up so update slower.
    staleTime: ({ state }) => 1000 * (isLiveComplete(state.data, to) ? 60 : 10),
    refetchInterval: ({ state }) => 60 * 1000 * (isLiveComplete(state.data, to) ? 10 : 1),
    gcTime: 10 * 1000,
    // placeholderData: lastFetch!.current?.selectData(from, to),
  });
}

export function useFlux(from: number, to: number, resolution: number): FluxSections {
  const lastFetch = useRef<FluxSections>([]);
  const { data = [], isFetched } = useQuery({
    ...fluxQueryOptions(from, to, resolution),
    placeholderData: selectFluxSections(lastFetch.current, from, to),
    enabled: !Number.isNaN(from) && !Number.isNaN(to) && resolution > 0,
  });
  if (isFetched) lastFetch.current = data;
  return data;
}

/**
 * {@link useFlux} but debounces its input parameters.
 */
export function useDebouncedFlux(
  from: number,
  to: number,
  resolution: number,
  delayMs = 500,
  maxWaitMs = 200
): FluxSections {
  const [[debouncedFrom, debouncedTo, debouncedResolution]] = useDebounce(
    [from, to, resolution],
    delayMs,
    { leading: true, maxWait: maxWaitMs }
  );
  const data = useFlux(debouncedFrom, debouncedTo, debouncedResolution);
  return useMemo(() => selectFluxSections(data, from, to), [data, from, to]);
}

/**
 * {@link useDebouncedFlux} but aligns its parameters to certain grids,
 * making it use the cache more often.
 */
export function useStableDebouncedFlux(
  from: number,
  to: number,
  resolution: number,
  resolutionStepSize = 200,
  intervalStepSize = 1.4,
  relativeChunkSize = 0.5
): FluxSections {
  // Stabilize resolution
  let stableResolution = resCeil(resolution, resolutionStepSize);

  // Stabilize interval
  const interval = (to - from) / stableResolution;
  const stableInterval = expCeil(interval, intervalStepSize);

  // Stabilize from and to
  const chunkSize = stableInterval * stableResolution * relativeChunkSize;
  const stableFrom = resFloor(from, chunkSize);
  const stableTo = resCeil(to, chunkSize);
  stableResolution = Math.ceil((stableTo - stableFrom) / stableInterval);

  const data = useDebouncedFlux(stableFrom, stableTo, stableResolution);
  return useMemo(() => selectFluxSections(data, from, to), [data, from, to]);
}
