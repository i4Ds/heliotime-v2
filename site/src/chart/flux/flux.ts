import { FluxSeries } from '@/api/flux';
import { NumberRange } from '@/utils/range';
import { toSuperScript } from '@/utils/super';
import { TickFormatter } from '@visx/axis';
import { NumberLike } from '@visx/scale';
import { extent } from 'd3-array';

export type View = Readonly<NumberRange>;

export function timeExtent(navData: FluxSeries | undefined): NumberRange | undefined {
  return (navData?.length ?? 0) === 0 ? undefined : [navData![0][0], Date.now()];
}

export function wattExtent(
  data: FluxSeries | undefined,
  extend = 0,
  minLogRange = 0.2
): NumberRange | undefined {
  const [min, max] = extent(data ?? [], (r) => r[1]);
  if (min === undefined) return undefined;
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  const logRange = logMax - logMin;
  const logExtendedRange = Math.max(logRange * (1 + 2 * extend), minLogRange);
  const extension = (logExtendedRange - logRange) / 2;
  return [10 ** (logMin - extension), 10 ** (logMax + extension)];
}

function padZeros(value: number, digits = 2): string {
  return value.toFixed(0).padStart(digits, '0');
}

function formatDate(value: Date, intervalMs: number): string | undefined {
  if (value.getTime() !== new Date(value).setUTCHours(0, 0, 0, 0)) return undefined;
  let text = padZeros(value.getUTCFullYear(), 4);
  if (intervalMs < 364 * 24 * 60 * 60 * 1000) text += `-${padZeros(value.getUTCMonth() + 1)}`;
  if (intervalMs < 27 * 24 * 60 * 60 * 1000) text += `-${padZeros(value.getUTCDate())}`;
  return text;
}

export const formatTime: TickFormatter<Date | NumberLike> = (value, index, values) => {
  if (!(value instanceof Date)) return undefined;
  const intervalMs = (values[1] ?? values[0]).value.valueOf() - values[0].value.valueOf();

  let timeText: string | undefined;
  if (intervalMs < 24 * 60 * 60 * 1000) {
    timeText = `${padZeros(value.getUTCHours())}:${padZeros(value.getUTCMinutes())}`;
    if (intervalMs < 60 * 1000) timeText += `:${padZeros(value.getUTCSeconds())}`;
    if (intervalMs < 1000) timeText += `:${padZeros(value.getUTCMilliseconds(), 3)}`;
  }

  const dateText = formatDate(value, intervalMs);
  return timeText && dateText ? `${timeText} ${dateText}` : (timeText ?? dateText);
};

export const formatTimeOnlyDate: TickFormatter<Date | NumberLike> = (value, index, values) => {
  if (!(value instanceof Date)) return undefined;
  const intervalMs = (values[1] ?? values[0]).value.valueOf() - values[0].value.valueOf();
  return formatDate(value, intervalMs);
};

export const formatWatt: TickFormatter<NumberLike> = (value, index, values) => {
  /**
   * WARNING: do not use this formatter on ranges logarithmically smaller than
   *  0.2 because the tick labels aren't precise enough and will create duplicates.
   */
  const exponent = Math.log10(value.valueOf());
  const flooredExponent = Math.floor(exponent);
  const range = values.at(-1)!.value.valueOf() / values[0].value.valueOf();

  const baseText = `10${toSuperScript(flooredExponent.toString())}`;
  if (range > 20) return exponent === flooredExponent ? baseText : undefined;

  const coefficient = value.valueOf() / 10 ** flooredExponent;
  let coefficientText = coefficient.toFixed(1);
  if (range > 3) {
    if (!coefficientText.endsWith('.0')) return undefined;
    coefficientText = coefficientText.slice(0, -2);
  }
  return `${coefficientText}×${baseText}`;
};
