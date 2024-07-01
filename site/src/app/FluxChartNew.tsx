import { FluxMeasurement, FluxSeries, fluxQuery } from '@/api/flux';
import { useQuery } from '@tanstack/react-query';
import { AxisBottom, AxisLeft, AxisTop } from '@visx/axis';
import { Brush } from '@visx/brush';
import BaseBrush from '@visx/brush/lib/BaseBrush';
import { localPoint } from '@visx/event';
import { GridColumns } from '@visx/grid';
import { scaleLog, scaleTime } from '@visx/scale';
import { Circle, Line, LinePath } from '@visx/shape';
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
  const { data: navData } = useQuery(fluxQuery(width));

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
        range: [height - 25, 0],
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
      <GridColumns scale={timeScale} height={height} />
      <LinePath
        data={navData}
        x={(d) => timeScale(d[0])}
        y={(d) => wattScale(d[1])}
        stroke={LINE_COLOR}
      />
      <AxisTop top={height} scale={timeScale} />
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
  const { data } = useQuery(fluxQuery(width, view?.[0], view?.[1]));

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
      <rect width={width} height={height} fill="transparent" />
      <GridColumns scale={timeScale} height={height} />
      <LinePath data={data} x={(d) => timeScale(d[0])} y={(d) => wattScale(d[1])} stroke={LINE_COLOR} />
      <AxisBottom top={height} scale={timeScale} />
      <AxisLeft scale={wattScale} />
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
  const brushHeight = height * 0.2;
  const marginLeft = 50;

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
