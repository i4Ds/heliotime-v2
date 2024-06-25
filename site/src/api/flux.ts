export type FluxSeries = [timestamp: number, watts: number][];

export async function fetchFluxSeries(
  from: number,
  to: number,
  resolution: number,
  signal?: AbortSignal
): Promise<FluxSeries> {
  const params = new URLSearchParams({
    start: new Date(from).toISOString(),
    end: new Date(to).toISOString(),
    resolution: resolution.toString(),
  });
  // TODO: make endpoint configurable
  const response = await fetch(`http://localhost:8000/flux?${params}`, { signal });
  return response.json();
}
