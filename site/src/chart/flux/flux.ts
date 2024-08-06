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

function floatRound(value: number): number {
  const roundDigit = Math.ceil(-Math.log10(value)) + 5;
  const normalization = 10 ** roundDigit;
  return Math.round(value * normalization) / normalization;
}

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

  const minExponent = Math.floor(minLogValue);
  const minMultiplier = 10 ** minExponent;
  const minCoefficient = minValue / minMultiplier;

  const coefficientStep = floatRound(
    (maxValue / minMultiplier - minCoefficient) / (values.length - 1)
  );
  let digits = Math.ceil(-Math.log10(coefficientStep));

  const coefficient = value.valueOf() / 10 ** exponent;
  // If coefficient is an int, show predefined ticks
  if (digits === 0 && values.length >= 5) {
    if (![1, 2, 5].includes(Math.round(coefficient))) return undefined;
  } else {
    const maxCoefficient = maxValue / 10 ** maxExponent;
    const coefficientDecimalNormalization = 10 ** (digits - 1);
    const coefficientDecimalRange =
      Math.floor(maxCoefficient * coefficientDecimalNormalization) -
      Math.ceil(minCoefficient * coefficientDecimalNormalization);

    // If there is more than one tick with a coefficient ending with 0 only display those
    if (coefficientDecimalRange > 0) {
      if (!coefficient.toFixed(digits).endsWith('0')) return undefined;
      digits -= 1;

      // Else show min, max, and middle value
    } else if (
      index !== 0 &&
      index !== values.length - 1 &&
      index !== Math.floor(values.length / 2)
    )
      return undefined;
  }
  return `${coefficient.toFixed(digits)}×${baseText}`;
};
