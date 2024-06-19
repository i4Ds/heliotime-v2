export type FluxSeries = [timestamp: number, watts: number][];

export async function fetchFluxSeries(
  from: number,
  to: number,
  resolution: number,
  signal?: AbortSignal
): Promise<FluxSeries> {
  const params = new URLSearchParams({
    from: from.toString(),
    to: to.toString(),
    points: resolution.toString(),
  });
  const response = await fetch(`https://heliotime.org/api/?${params}`, { signal });
  return response.json();
}
