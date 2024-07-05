import { queryOptions } from '@tanstack/react-query';
import { useRef } from 'react';

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

class Fetch {
  static readonly TOO_LOW_RES_THRESHOLD = 1.5;

  static readonly MIN_LIVE_LAG_MS = 3 * 60 * 1000;

  readonly createdAt: number = Date.now();

  constructor(
    readonly data: FluxSeries,
    readonly resolution: number,
    readonly from = 0, // TODO: make global constant
    readonly to = Date.now()
  ) {}

  /**
   * Wether the provided configuration is equal enough to this fetch's configuration
   * for it to make nearly no visual difference if we were to actually fetch it
   * assuming no new data becomes available on the backend.
   *
   * @param from Defaults to 1970-01-01 before the first GOES Satellite existed.
   * @param to Defaults to now.
   */
  isVisuallyEqual(resolution: number, from = 0, to = Date.now()): boolean {
    if (this.from === from && this.to === to && this.resolution === resolution) return true;
    if (this.data.length < 2) return false;

    // Check if fetch resolution is too low
    const startInterval = this.data[1][0] - this.data[0][0];
    const interval = Fetch.calcInterval(this.from, this.to, this.resolution);
    // If data has the requested resolution or higher (or tiny bit lower cause of inaccuracies)
    // we have not yet reached the max resolution and can fetch better resolution.
    // startInterval represents data resolution because it is the smallest if archive and live data is mixed.
    if (startInterval <= interval + 100) {
      const otherInterval = Fetch.calcInterval(from, to, resolution);
      // console.log(interval / otherInterval);
      if (interval > otherInterval * Fetch.TOO_LOW_RES_THRESHOLD) return false;
    }

    // Check if another interval could fit at the start
    if (from < this.from - startInterval) return false;

    // Check if another interval could fit at the end
    const endInterval = this.data.at(-1)![0] - this.data.at(-2)![0];
    return to <= this.to + endInterval;
  }

  selectData(from?: number, to?: number): FluxSeries {
    return selectFlux(this.data, from, to);
  }

  private static calcInterval(from: number, to: number, resolution: number) {
    return (to - from) / resolution;
  }

  /**
   * If the fetched data has data up until the end,
   * meaning at least the live data has fully caught up.
   */
  isLiveComplete(): boolean {
    if (this.data.length < 2) return false;
    const last = this.data.at(-1)![0];
    const lastInterval = last - this.data.at(-2)![0];
    return this.to < last + lastInterval;
  }
}

export function useFluxQuery(resolution: number, from?: number, to?: number) {
  const lastFetch = useRef<Fetch | undefined>(undefined);
  return queryOptions({
    queryKey: ['flux', from, to, resolution, lastFetch],
    queryFn: async () => {
      const series = await fetchFluxSeries(resolution, from, to);
      lastFetch.current = new Fetch(series, resolution, from, to);
      return series;
    },
    // @ts-expect-error Accepts both FluxSeries and undefined but TS doesn't check it correctly
    initialData: lastFetch.current?.isVisuallyEqual(resolution, from, to)
      ? lastFetch.current?.selectData(from, to)
      : undefined,
    initialDataUpdatedAt: lastFetch.current?.createdAt,
    // When data is live complete only the archive data could slowly catch up so update slower.
    staleTime: () => 1000 * (lastFetch.current?.isLiveComplete() ? 60 : 10),
    refetchInterval: () => 60 * 1000 * (lastFetch.current?.isLiveComplete() ? 10 : 1),
    gcTime: 10 * 1000,
    placeholderData: lastFetch.current?.selectData(from, to),
  });
}
