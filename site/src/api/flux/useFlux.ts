import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { useDebounce } from 'use-debounce';
import { expCeil, resCeil, resFloor } from '@/utils/math';
import { FluxSections, selectFluxSections, splitFluxByHoles } from './data';
import { fetchFluxSeries } from './api';

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

export function fluxQueryOptions(from: number, to: number, resolution: number) {
  return queryOptions({
    queryKey: ['flux', from, to, resolution],
    queryFn: async () =>
      splitFluxByHoles(await fetchFluxSeries(resolution, from, to), (to - from) / resolution),
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
    useMemo(() => [from, to, resolution], [from, to, resolution]),
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
