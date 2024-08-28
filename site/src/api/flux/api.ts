import { NumberRange } from "@/utils/range";
import { FluxSeries } from "./data";

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
