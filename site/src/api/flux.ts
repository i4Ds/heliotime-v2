import { queryOptions } from '@tanstack/react-query';

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

let lastFetch: FluxSeries | undefined;

function select(series: FluxSeries, start?: number, end?: number): FluxSeries {
  const firstInclusive = series.findIndex(
    ([timestamp]) => start === undefined || start < timestamp
  );
  const lastInclusive = series.findLastIndex(([timestamp]) => end === undefined || timestamp < end);
  return series.slice(firstInclusive, lastInclusive + 1);
}

export function fluxQuery(resolution: number, from?: number, to?: number) {
  return queryOptions({
    queryKey: ['flux', from, to, resolution],
    queryFn: async () => {
      const series = await fetchFluxSeries(resolution, from, to);
      lastFetch = series;
      return series;
    },
    // TODO: use better initial data strategy
    initialData: () => (lastFetch === undefined ? [] : select(lastFetch, from, to)),
    // Immediately fetch actual data
    initialDataUpdatedAt: 0,
  });
}
