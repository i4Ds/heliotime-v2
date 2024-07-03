import { FluxSeries } from '@/api/flux';
import { NumberRange } from '@/utils/range';
import { NumberLike } from '@visx/scale';
import { extent } from 'd3-array';
import { createContext, useState } from 'react';

// TODO: style properly
export const LINE_COLOR = '#2582ec';

export type View = Readonly<NumberRange> | undefined

export const ViewContext = createContext<ReturnType<typeof useState<NumberRange | undefined>>>([
  undefined,
  () => {},
]);

export function timeExtent(navData: FluxSeries | undefined): NumberRange | undefined {
  return (navData?.length ?? 0) === 0 ? undefined : [navData![0][0], Date.now()];
}

export function wattExtent(data: FluxSeries | undefined): NumberRange | undefined {
  const minMax = extent(data ?? [], (r) => r[1]);
  return minMax[0] === undefined ? undefined : minMax;
}

function padZeros(value: number, digits = 2): string {
  return value.toFixed(0).padStart(digits, '0');
}

export function formatTime(value: Date | NumberLike): string | undefined {
  if (!(value instanceof Date)) return undefined;
  if (value.getTime() === new Date(value).setHours(0, 0, 0, 0)) {
    let text = padZeros(value.getFullYear(), 4);
    if (value.getMonth() !== 0 || value.getDate() !== 1)
      text += `-${padZeros(value.getMonth() + 1)}`;
    if (value.getDate() !== 1) text += `-${padZeros(value.getDate())}`;
    return text;
  }
  let text = `${padZeros(value.getHours())}:${padZeros(value.getMinutes())}`;
  if (value.getSeconds() !== 0) text += `:${padZeros(value.getSeconds())}`;
  if (value.getMilliseconds() !== 0) text += `:${padZeros(value.getMilliseconds(), 3)}`;
  return text;
}
