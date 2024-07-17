import { FluxSeries } from '@/api/flux';
import { NumberRange } from '@/utils/range';
import { NumberLike } from '@visx/scale';
import { extent } from 'd3-array';

// TODO: style properly
export const LINE_COLOR = '#2582ec';

export type View = Readonly<NumberRange>;

export function timeExtent(navData: FluxSeries | undefined): NumberRange | undefined {
  return (navData?.length ?? 0) === 0 ? undefined : [navData![0][0], Date.now()];
}

export function wattExtent(data: FluxSeries | undefined, extend = 1): NumberRange | undefined {
  const [min, max] = extent(data ?? [], (r) => r[1]);
  // Clamp min value because bellow 1e-9 we run into floating point issues
  return min === undefined ? undefined : [Math.max(min / extend, 1e-9), max * extend];
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