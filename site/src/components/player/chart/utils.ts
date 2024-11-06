import { FluxSeries } from '@/api/flux/data';
import { NumberRange } from '@/utils/range';
import { toSuperScript } from '@/utils/super';
import { AxisBottom, AxisLeft, AxisTop, TickFormatter } from '@visx/axis';
import { NumberLike } from '@visx/scale';
import { extent } from 'd3-array';
import { memo } from 'react';

export const MemoAxisLeft = memo(AxisLeft);
export const MemoAxisBottom = memo(AxisBottom);
export const MemoAxisTop = memo(AxisTop);

export function timeExtent(navData: FluxSeries | undefined): NumberRange | undefined {
  return (navData?.length ?? 0) === 0 ? undefined : [navData![0][0], Date.now()];
}

export const MAX_WATT_EXTENT = [1e-9, 1e-2];

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

function isOnlyDate(value: Date): boolean {
  return (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  );
}

function formatTime(value: Date, intervalMs: number): string {
  let text = `${padZeros(value.getUTCHours())}:${padZeros(value.getUTCMinutes())}`;
  if (intervalMs < 60 * 1000) text += `:${padZeros(value.getUTCSeconds())}`;
  if (intervalMs < 1000) text += `:${padZeros(value.getUTCMilliseconds(), 3)}`;
  return text;
}

function formatDate(value: Date, intervalMs: number): string {
  let text = padZeros(value.getUTCFullYear(), 4);
  if (intervalMs < 364 * 24 * 60 * 60 * 1000) text += `-${padZeros(value.getUTCMonth() + 1)}`;
  if (intervalMs < 27 * 24 * 60 * 60 * 1000) text += `-${padZeros(value.getUTCDate())}`;
  return text;
}

export function formatTimeCursor(timestamp: number, intervalMsEstimate: number): string {
  const value = new Date(timestamp);
  // Be a bit more conservative with the estimate
  const intervalMs = intervalMsEstimate * 0.8;
  // Cursor should be more precise than ticks as it's not aligned
  const precisionMs = intervalMs * 0.1;
  if (intervalMs <= 24 * 60 * 60 * 1000) return formatTime(value, precisionMs);
  // Still show time if precision is too low
  if (precisionMs <= 24 * 60 * 60 * 1000)
    return `${value.getUTCDate()} ${formatTime(value, precisionMs)}`;
  return formatDate(value, precisionMs);
}

export const formatTimeTick: TickFormatter<Date | NumberLike> = (value, index, values) => {
  if (!(value instanceof Date)) return undefined;
  const intervalMs = (values[1] ?? values[0]).value.valueOf() - values[0].value.valueOf();
  const timeText = intervalMs < 24 * 60 * 60 * 1000 ? formatTime(value, intervalMs) : undefined;
  const dateText = isOnlyDate(value) ? formatDate(value, intervalMs) : undefined;
  return timeText && dateText ? `${timeText} ${dateText}` : (timeText ?? dateText);
};

export const calcTimeTicks = (width: number) => Math.max(width / 160, 2);

export const formatDateTick: TickFormatter<Date | NumberLike> = (value, index, values) => {
  if (!(value instanceof Date)) return undefined;
  const intervalMs = (values[1] ?? values[0]).value.valueOf() - values[0].value.valueOf();
  // Only label pure dates to prevent double labeling
  return isOnlyDate(value) ? formatDate(value, intervalMs) : undefined;
};

export const formatWattTick: TickFormatter<NumberLike> = (value, index, values) => {
  const logValue = Math.log10(value.valueOf());
  const exponent = Math.floor(logValue);

  const minValue = values[0].value.valueOf();
  const maxValue = values.at(-1)!.value.valueOf();
  const minLogValue = Math.log10(minValue);
  const maxLogValue = Math.log10(maxValue);
  const maxExponent = Math.floor(maxLogValue);

  const exponentRange = maxExponent - Math.ceil(minLogValue);
  const baseText = `10${toSuperScript(exponent.toString())}`;
  if (exponentRange > 0) return logValue === exponent ? baseText : undefined;

  const maxMultiplier = 10 ** maxExponent;
  const maxCoefficient = maxValue / maxMultiplier;
  const beforeMaxCoefficient = values.at(-2)!.value.valueOf() / maxMultiplier;
  // Measure coefficient step at top because on a 10^x border the upper part will first be split
  const coefficientStep = maxCoefficient - beforeMaxCoefficient;
  // Multiply by 1.001 to counteract floating point errors where the step is 0.09999
  let fractionDigits = -Math.floor(Math.log10(coefficientStep * 1.001));

  const coefficient = value.valueOf() / 10 ** exponent;
  // If coefficient is an int, show predefined ticks
  if (fractionDigits === 0 && values.length > 7) {
    if (![1, 2, 5].includes(Math.round(coefficient))) return undefined;
  } else {
    const minExponent = Math.floor(minLogValue);
    const minCoefficient = minValue / 10 ** minExponent;
    const coefficientDecimalNormalization = 10 ** (fractionDigits - 1);
    const coefficientDecimalRange =
      // Multiply by 1.1 and 0.9 to account for float imprecision
      Math.floor(maxCoefficient * coefficientDecimalNormalization * 1.001) -
      Math.ceil(minCoefficient * coefficientDecimalNormalization * 0.999);

    // If there is more than one tick with a coefficient ending with 0 only display those
    if (
      (coefficientDecimalRange < -1 || coefficientDecimalRange > 0) &&
      (minCoefficient <= 8 || maxCoefficient >= 2)
    ) {
      if (!coefficient.toFixed(fractionDigits).endsWith('0')) return undefined;
      fractionDigits -= 1;

      // Else show min, max, and middle value
    } else if (
      !coefficient.toFixed(fractionDigits).endsWith('0') &&
      index !== 0 &&
      index !== values.length - 1 &&
      index !== Math.floor(values.length / 2)
    )
      return undefined;
  }
  return `${coefficient.toFixed(fractionDigits)}×${baseText}`;
};
