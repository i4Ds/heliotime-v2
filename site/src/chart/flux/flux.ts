import { FluxSeries } from '@/api/flux/data';
import { NumberRange } from '@/utils/range';
import { toSuperScript } from '@/utils/super';
import { TickFormatter } from '@visx/axis';
import { NumberLike } from '@visx/scale';
import { extent } from 'd3-array';
import { createParser } from 'nuqs';

export type View = Readonly<NumberRange>;

const DEFAULT_VIEW_SIZE_MS = 24 * 60 * 60 * 1000;

export const parseAsView = createParser<View>({
  parse(value) {
    const [start, end] = value.split('~').map((v) => Date.parse(v));
    // eslint-disable-next-line unicorn/no-null
    if (!Number.isFinite(start)) return null;
    return [start, Number.isFinite(end) ? end : start + DEFAULT_VIEW_SIZE_MS];
  },
  serialize(view) {
    return view.map((date) => new Date(date).toISOString()).join('~');
  },
});

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
  // Multiply by 1.1 to counteract floating point errors where the step is 0.09999
  let digits = -Math.floor(Math.log10(coefficientStep * 1.1));

  const coefficient = value.valueOf() / 10 ** exponent;
  // If coefficient is an int, show predefined ticks
  if (digits === 0 && values.length > 7) {
    if (![1, 2, 5].includes(Math.round(coefficient))) return undefined;
  } else {
    const minExponent = Math.floor(minLogValue);
    const minCoefficient = minValue / 10 ** minExponent;
    const coefficientDecimalNormalization = 10 ** (digits - 1);
    const coefficientDecimalRange =
      // Multiply by 1.1 and 0.9 to account for float imprecision
      Math.floor(maxCoefficient * coefficientDecimalNormalization * 1.1) -
      Math.ceil(minCoefficient * coefficientDecimalNormalization * 0.9);

    // If there is more than one tick with a coefficient ending with 0 only display those
    if (
      (coefficientDecimalRange < -1 || coefficientDecimalRange > 0) &&
      (minCoefficient <= 8 || maxCoefficient >= 2)
    ) {
      if (!coefficient.toFixed(digits).endsWith('0')) return undefined;
      digits -= 1;

      // Else show min, max, and middle value
    } else if (
      !coefficient.toFixed(digits).endsWith('0') &&
      index !== 0 &&
      index !== values.length - 1 &&
      index !== Math.floor(values.length / 2)
    )
      return undefined;
  }
  return `${coefficient.toFixed(digits)}×${baseText}`;
};
