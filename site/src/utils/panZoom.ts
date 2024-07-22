import { NumberRange } from './range';

export function limitView(
  [start, end]: Readonly<NumberRange>,
  [min, max]: Readonly<NumberRange>
): Readonly<NumberRange> {
  if (end - start > max - min) return [Math.max(start, min), Math.min(end, max)];
  if (start < min) return [min, end + (min - start)];
  if (max < end) return [start - (end - max), max];
  return [start, end];
}

export function panView([start, end]: Readonly<NumberRange>, delta: number): Readonly<NumberRange> {
  return [start + delta, end + delta];
}

export function zoomView(
  [start, end]: Readonly<NumberRange>,
  zoomFactor: number,
  focus: number,
  minSize = 0
): Readonly<NumberRange> {
  const range = end - start;
  // Calculate the relative focus position (0 to 1) within the current range
  const focusRatio = (focus - start) / range;
  const newRange = Math.max(range / zoomFactor, minSize);
  return [focus - newRange * focusRatio, focus + newRange * (1 - focusRatio)];
}

export function wheelZoomView(
  view: Readonly<NumberRange>,
  wheelDelta: number,
  focus = (view[0] + view[1]) / 2,
  minSize?: number
): Readonly<NumberRange> {
  const zoomFactor = 1.1 ** (wheelDelta * -0.01);
  return zoomView(view, zoomFactor, focus, minSize);
}

export function pointerPanZoomView(
  view: Readonly<NumberRange>,
  previousPointer: number,
  currentPointer: number,
  previousSecondPointer?: number,
  currentSecondPointer?: number,
  previousDistance?: number,
  currentDistance?: number,
  minSize?: number
): Readonly<NumberRange> {
  // Single pointer: Only pan
  if (currentSecondPointer === undefined || previousSecondPointer === undefined)
    return panView(view, previousPointer - currentPointer);

  // Two pointers: Do both
  // Pan
  const previousMiddle = (previousPointer + previousSecondPointer) / 2;
  const currentMiddle = (currentPointer + currentSecondPointer) / 2;
  const pannedView = panView(view, previousMiddle - currentMiddle);
  // Zoom
  const actualPreviousDistance =
    previousDistance ?? Math.abs(previousPointer - previousSecondPointer);
  const actualCurrentDistance = currentDistance ?? Math.abs(currentPointer - currentSecondPointer);
  const zoomFactor = actualCurrentDistance / actualPreviousDistance;
  return zoomView(pannedView, zoomFactor, previousMiddle, minSize);
}
