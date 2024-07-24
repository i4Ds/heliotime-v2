import { FluxSeries } from '@/api/flux';
import { NumberRange } from '@/utils/range';
import { NumberLike } from '@visx/scale';
import { extent } from 'd3-array';

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
  if (value.getTime() === new Date(value).setUTCHours(0, 0, 0, 0)) {
    let text = padZeros(value.getUTCFullYear(), 4);
    if (value.getUTCMonth() !== 0 || value.getUTCDate() !== 1)
      text += `-${padZeros(value.getUTCMonth() + 1)}`;
    if (value.getUTCDate() !== 1) text += `-${padZeros(value.getUTCDate())}`;
    return text;
  }
  let text = `${padZeros(value.getUTCHours())}:${padZeros(value.getUTCMinutes())}`;
  if (value.getUTCSeconds() !== 0) text += `:${padZeros(value.getUTCSeconds())}`;
  if (value.getUTCMilliseconds() !== 0) text += `:${padZeros(value.getUTCMilliseconds(), 3)}`;
  return text;
}
