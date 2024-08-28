import { splitByDelta } from '@/utils/array';

export type FluxMeasurement = [timestamp: number, watts: number];
export type FluxSeries = FluxMeasurement[];
export type FluxSections = FluxSeries[];

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

const MAX_INTERVALS_SKIPPED = 3;
const MIN_ALLOWED_DELTA_MS = 60 * 1000;

export function splitFluxByHoles(series: FluxSeries, intervalMs: number): FluxSections {
  const maxDelta = Math.max(MIN_ALLOWED_DELTA_MS, MAX_INTERVALS_SKIPPED * intervalMs);
  return splitByDelta(series, (d) => d[0], maxDelta);
}
