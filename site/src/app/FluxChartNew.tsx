import { FluxMeasurement, FluxSeries, useFluxQuery } from '@/api/flux';
import { useQuery } from '@tanstack/react-query';
import { AxisBottom, AxisLeft, AxisTop } from '@visx/axis';
import { Brush } from '@visx/brush';
import BaseBrush from '@visx/brush/lib/BaseBrush';
import { localPoint } from '@visx/event';
import { GridColumns } from '@visx/grid';
import { AnyD3Scale, NumberLike, ScaleInput, scaleLog, scaleTime } from '@visx/scale';
import { Circle, Line, LinePath } from '@visx/shape';
import { Text, TextProps } from '@visx/text';
import { useTooltip, useTooltipInPortal } from '@visx/tooltip';
import { bisector, extent } from 'd3-array';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';

// TODO: style properly
const LINE_COLOR = '#2582ec';

type Range = [start: number, end: number];

function timeExtent(navData: FluxSeries | undefined): Range | undefined {
  return (navData?.length ?? 0) === 0 ? undefined : [navData![0][0], Date.now()];
}

function wattExtent(data: FluxSeries | undefined): Range | undefined {
  const minMax = extent(data ?? [], (r) => r[1]);
  return minMax[0] === undefined ? undefined : minMax;
}

function padZeros(value: number, digits = 2): string {
  return value.toFixed(0).padStart(digits, '0');
}

function formatTime(value: Date | NumberLike): string | undefined {
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

interface BasicProps {
  width: number;
  height: number;
  top?: number;
  left?: number;
}

interface FluxBrushRef {
  updateBrush(range: Range | undefined): void;
}

interface FluxBrushProps extends BasicProps {
  onBrush?: (range: Range | undefined) => void;
}

// eslint-disable-next-line prefer-arrow-callback
const FluxBrush = forwardRef<FluxBrushRef, FluxBrushProps>(function FluxBrush(
  { width, height, top, left, onBrush },
  ref
) {
  const { data: navData } = useQuery(useFluxQuery(width));

  const timeScale = useMemo(
    () =>
      scaleTime({
        range: [0, width],
        domain: timeExtent(navData),
      }),
    [navData, width]
  );

  const wattScale = useMemo(
    () =>
      scaleLog({
        // Don't go all the way down to prevent overlap with label
        range: [height - 15, 0],
        domain: wattExtent(navData),
      }),
    [height, navData]
  );

  const brushRef = useRef<BaseBrush | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      updateBrush(range) {
        const currentRef = brushRef.current;
        if (currentRef === null) return;
        if (range === undefined) {
          currentRef.reset();
          return;
        }
        currentRef?.updateBrush((previous) => {
          const newExtent = currentRef.getExtent(
            { x: timeScale(range[0]) },
            { x: timeScale(range?.[1]) }
          );
          return {
            ...previous,
            start: { y: newExtent.y0, x: newExtent.x0 },
            end: { y: newExtent.y1, x: newExtent.x1 },
            extent: newExtent,
          };
        });
      },
    }),
    [timeScale]
  );

  // TODO: find better solution
  // Only propagate onChange events if it is user initiated
  const recordBrush = useRef(false);
  return (
    <svg
      width={width}
      height={height}
      y={top}
      x={left}
      onMouseEnter={() => {
        recordBrush.current = true;
      }}
      onMouseLeave={() => {
        recordBrush.current = false;
      }}
    >
      <GridColumns scale={timeScale} height={height} numTicks={8} stroke="#0002" />
      <LinePath
        data={navData}
        x={(d) => timeScale(d[0])}
        y={(d) => wattScale(d[1])}
        stroke={LINE_COLOR}
      />
      <AxisTop
        top={height}
        scale={timeScale}
        tickFormat={formatTime}
        numTicks={8}
        hideTicks
        tickLength={-3}
      />
      <Brush
        innerRef={brushRef}
        xScale={timeScale}
        yScale={wattScale}
        height={height}
        width={width}
        onChange={(bounds) => {
          if (!recordBrush.current) return;
          onBrush?.(bounds === null ? undefined : [bounds.x0, bounds.x1]);
        }}
      />
    </svg>
  );
});

interface HorizontalBandProps<Scale extends AnyD3Scale>
  extends Omit<React.SVGProps<SVGRectElement>, 'scale' | 'x' | 'y' | 'width' | 'height'> {
  scale: Scale;
  from: ScaleInput<Scale>;
  to: ScaleInput<Scale>;
  x?: number;
  y?: number;
  width: number;
  height: number;
  label?: string;
  labelOffset?: number;
  showLabelRelativeThreshold?: number;
  showLabelAbsoluteThreshold?: number;
  labelProps?: Omit<TextProps, 'x' | 'y' | 'verticalAnchor'>;
}

function HorizontalBand<Scale extends AnyD3Scale>({
  scale,
  from,
  to,
  x = 0,
  y = 0,
  width,
  height,
  label,
  labelOffset = 5,
  labelProps = {},
  showLabelRelativeThreshold = 0.5,
  showLabelAbsoluteThreshold = height * 0.3,
  ...rectProps
}: HorizontalBandProps<Scale>) {
  const y0 = scale(from);
  const y1 = scale(to);
  if (height < y0 || y1 < 0) return undefined;
  const clippedY0 = Math.max(0, y0);
  const clippedY1 = Math.min(height, y1);
  const clippedHeight = clippedY1 - clippedY0;
  const trueHeight = y1 - y0;
  const showLabel =
    clippedHeight / trueHeight > showLabelRelativeThreshold ||
    clippedHeight > showLabelAbsoluteThreshold;
  return (
    <svg x={x} y={clippedY0 + y} width={width} height={clippedHeight} className="overflow-visible">
      <rect
        x={0}
        y={0}
        width={width}
        height={clippedHeight}
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...rectProps}
      />
      {showLabel && (
        <Text
          x={labelOffset}
          y={clippedHeight / 2}
          verticalAnchor="middle"
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...labelProps}
        >
          {label}
        </Text>
      )}
    </svg>
  );
}

const SUPERSCRIPTS: Record<string, string> = {
  ' ': ' ',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  a: 'ᵃ',
  b: 'ᵇ',
  c: 'ᶜ',
  d: 'ᵈ',
  e: 'ᵉ',
  f: 'ᶠ',
  g: 'ᵍ',
  h: 'ʰ',
  i: 'ⁱ',
  j: 'ʲ',
  k: 'ᵏ',
  l: 'ˡ',
  m: 'ᵐ',
  n: 'ⁿ',
  o: 'ᵒ',
  p: 'ᵖ',
  r: 'ʳ',
  s: 'ˢ',
  t: 'ᵗ',
  u: 'ᵘ',
  v: 'ᵛ',
  w: 'ʷ',
  x: 'ˣ',
  y: 'ʸ',
  z: 'ᶻ',
};

function toSuperScript(text: string): string {
  return Array.from(text)
    .map((c) => SUPERSCRIPTS[c] ?? '')
    .join('');
}

interface FluxMainProps extends BasicProps {
  view?: [number, number];
  // TODO: expose zoom better
  setView?: (setter: (view?: [number, number]) => [number, number] | undefined) => void;
  onTimeSelect?: (timestamp: Date) => void;
}

function FluxMain({
  width,
  height,
  top = 0,
  left = 0,
  view,
  setView,
  onTimeSelect,
}: FluxMainProps) {
  const { data } = useQuery(useFluxQuery(width, view?.[0], view?.[1]));

  const timeScale = useMemo(
    () =>
      scaleTime({
        range: [0, width],
        domain: view ?? timeExtent(data),
      }),
    [data, view, width]
  );

  const wattScale = useMemo(
    () =>
      scaleLog({
        range: [height, 0],
        domain: wattExtent(data),
      }),
    [data, height]
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<SVGElement>) => {
      if (onTimeSelect === undefined) return;
      const point = localPoint(event);
      if (point === null) return;
      onTimeSelect(timeScale.invert(point.x));
    },
    [onTimeSelect, timeScale]
  );

  const { tooltipTop, tooltipLeft, tooltipData, showTooltip, hideTooltip } = useTooltip<number>();
  const { containerRef, TooltipInPortal } = useTooltipInPortal();
  const handleTooltip = useCallback(
    (event: React.TouchEvent<SVGElement> | React.MouseEvent<SVGElement>) => {
      const point = localPoint(event);
      if (point === null || data === undefined || data.length === 0) {
        hideTooltip();
        return;
      }
      const index = bisector<FluxMeasurement, number>((m) => m[0]).center(
        data,
        timeScale.invert(point.x).getTime()
      );
      const measurement = data[index];
      showTooltip({
        tooltipData: measurement[1],
        tooltipLeft: timeScale(measurement[0]),
        tooltipTop: point.y,
      });
    },
    [data, hideTooltip, showTooltip, timeScale]
  );

  const handleZoom = useCallback(
    (event: React.WheelEvent<SVGElement>) =>
      setView?.((current = timeScale.domain().map((d) => d.getTime()) as [number, number]) => {
        if (current === undefined) return undefined;
        const point = localPoint(event);
        if (point === null) return current;
        const [start, end] = current;
        const range = end - start;

        const zoomFactor = 1.1 ** (event.deltaY * -0.01);
        // TODO: make max zoom configurable
        const newRange = Math.max(range / zoomFactor, 5 * 60 * 1000);

        const focus = timeScale.invert(point.x).getTime();
        // Calculate the relative focus position (0 to 1) within the current range
        const focusRatio = (focus - start) / range;
        // TODO: limit zooming out
        const newStart = focus - newRange * focusRatio;
        const newEnd = focus + newRange * (1 - focusRatio);

        return [newStart, newEnd];
      }),
    [setView, timeScale]
  );

  return (
    <svg
      ref={containerRef}
      width={width}
      height={height}
      x={left}
      y={top}
      onClick={handleClick}
      onTouchStart={handleTooltip}
      onTouchMove={handleTooltip}
      onMouseMove={handleTooltip}
      onMouseLeave={() => hideTooltip()}
      // TODO: support touch
      onWheel={handleZoom}
      className="overflow-visible"
    >
      {/* Invisible rect to catch interaction events. */}
      <rect width={width} height={height} fill="transparent" />
      {[0, 1, 2, 3, 4].map((index) => (
        <HorizontalBand
          key={index}
          scale={wattScale}
          from={10 ** (-7 + index)}
          to={10 ** (-8 + index)}
          width={width}
          height={height}
          fill={index % 2 ? '#e6e9ff' : '#d1d7ff'}
          label={'ABCMX'[index]}
          labelOffset={-20}
          labelProps={{ textAnchor: 'end' }}
        />
      ))}
      <GridColumns scale={timeScale} height={height} numTicks={8} stroke="#0002" />
      <LinePath
        data={data}
        x={(d) => timeScale(d[0])}
        y={(d) => wattScale(d[1])}
        stroke={LINE_COLOR}
      />
      <AxisBottom top={height} scale={timeScale} tickFormat={formatTime} numTicks={8} />
      <AxisLeft
        scale={wattScale}
        label="X-ray Flux ( W/m² )"
        labelProps={{ fontSize: 13 }}
        labelOffset={40}
        tickLabelProps={{ fontSize: 13 }}
        tickFormat={(v) => {
          const exponent = Math.log10(v.valueOf());
          if (exponent % 1 !== 0) return undefined;
          return `10${toSuperScript(exponent.toString())}`;
        }}
      />
      {tooltipData && (
        <>
          <Circle cx={tooltipLeft} cy={wattScale(tooltipData)} r={3} />
          <Line y2={height} x1={tooltipLeft} x2={tooltipLeft} stroke="black" />
          <TooltipInPortal top={tooltipTop} left={tooltipLeft}>
            {tooltipData}
          </TooltipInPortal>
        </>
      )}
    </svg>
  );
}

export interface FluxChartProps {
  width: number;
  height: number;
  onTimeSelect?: (timestamp: Date) => void;
}

export default function FluxChartNew({ width, height, onTimeSelect }: FluxChartProps) {
  const brushHeight = height * 0.15;
  const marginLeft = 70;

  const brushRef = useRef<FluxBrushRef>(null);
  const [view, setView] = useState<[number, number] | undefined>();

  return (
    <svg width={width} height={height} className="overflow-visible">
      <FluxMain
        width={width - marginLeft}
        height={height - brushHeight - 40}
        left={marginLeft}
        view={view}
        setView={(setter) =>
          setView((previous) => {
            const next = setter(previous);
            brushRef.current?.updateBrush(next);
            return next;
          })
        }
        onTimeSelect={onTimeSelect}
      />
      <FluxBrush
        ref={brushRef}
        width={width - marginLeft}
        height={brushHeight}
        top={height - brushHeight}
        left={marginLeft}
        onBrush={(range) => setView(range)}
      />
    </svg>
  );
}
