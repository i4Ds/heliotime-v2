import { NumberRange } from './range';

export interface ZoomOptions {
  focus?: number;
  minRange?: number;
  maxRange?: number;
  minBound?: number;
  maxBound?: number;
}

export function zoomView(
  [start, end]: Readonly<NumberRange>,
  wheelDelta: number,
  { focus = start + end / 2, minRange = 0, maxRange, minBound, maxBound }: ZoomOptions = {}
): NumberRange {
  const range = end - start;
  const zoomFactor = 1.1 ** (wheelDelta * -0.01);
  // Calculate the relative focus position (0 to 1) within the current range
  const focusRatio = (focus - start) / range;

  let newRange = range / zoomFactor;
  if (minRange !== undefined) newRange = Math.max(newRange, minRange);
  if (maxRange !== undefined) newRange = Math.min(newRange, maxRange);

  let newStart = focus - newRange * focusRatio;
  if (minBound !== undefined) newStart = Math.max(newStart, minBound);
  let newEnd = focus + newRange * (1 - focusRatio);
  if (maxBound !== undefined) newEnd = Math.max(newStart, maxBound);

  return [newStart, newEnd];
}
