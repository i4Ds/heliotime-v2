import { FluxMeasurement, useStableDebouncedFlux } from '@/api/flux';
import { HorizontalBand } from '@/chart/HorizontalBand';
import { toSuperScript } from '@/utils/super';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { localPoint } from '@visx/event';
import { GridColumns } from '@visx/grid';
import { scaleLog, scaleTime } from '@visx/scale';
import { Circle, Line, LinePath } from '@visx/shape';
import { useTooltip, useTooltipInPortal } from '@visx/tooltip';
import { bisector } from 'd3-array';
import { Dispatch, useCallback, useMemo } from 'react';
import { NumberRange } from '@/utils/range';
import { pointerPanZoomView, wheelZoomView } from '@/utils/panZoom';
import { Point } from '@visx/point';
import { PointerStack } from '@/utils/pointer';
import { useWindowEvent } from '@/utils/useWindowEvent';
import { LINE_COLOR, View, formatTime, timeExtent, wattExtent } from './flux';
import { PositionSizeProps } from '../base';

function calcDistance(lastPointA: Point | undefined, lastPointB: Point | undefined) {
  return (
    lastPointA && lastPointB && Math.hypot(lastPointA.x - lastPointB.x, lastPointA.y - lastPointB.y)
  );
}

interface FluxMainProps extends PositionSizeProps {
  onTimeSelect?: (timestamp: Date) => void;
  minSizeMs: number;
  view: View;
  setView: Dispatch<(previous: View) => View>;
}

export function FluxMain({
  width,
  height,
  top = 0,
  left = 0,
  onTimeSelect,
  minSizeMs,
  view,
  setView,
}: FluxMainProps) {
  const data = useStableDebouncedFlux(view[0], view[1], width);

  const timeScale = useMemo(
    () =>
      scaleTime({
        range: [0, width],
        domain: view === undefined ? timeExtent(data) : Array.from(view),
      }),
    [data, view, width]
  );

  const wattScale = useMemo(
    () =>
      scaleLog({
        range: [height, 0],
        domain: wattExtent(data, 1.4),
        clamp: true,
      }),
    [data, height]
  );

  const { tooltipTop, tooltipLeft, tooltipData, showTooltip, hideTooltip } =
    useTooltip<FluxMeasurement>();
  const { containerRef, TooltipInPortal } = useTooltipInPortal();
  const updateTooltip = useCallback(
    (point?: Point) => {
      if (point === undefined || data.length === 0) {
        hideTooltip();
        return;
      }
      const index = bisector<FluxMeasurement, number>((m) => m[0]).center(
        data,
        timeScale.invert(point.x).getTime()
      );
      const measurement = data[index];
      showTooltip({
        tooltipData: measurement,
        tooltipLeft: timeScale(measurement[0]),
        tooltipTop: point.y,
      });
    },
    [data, hideTooltip, showTooltip, timeScale]
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

  const handleWheel = useCallback(
    (event: React.WheelEvent<SVGElement>) =>
      setView((current) => {
        const point = localPoint(event);
        if (point === null) return current;
        const currentOrDomain =
          current ?? (timeScale.domain().map((d) => d.getTime()) as NumberRange);
        return wheelZoomView(
          currentOrDomain,
          event.deltaY,
          timeScale.invert(point.x).getTime(),
          minSizeMs
        );
      }),
    [minSizeMs, setView, timeScale]
  );

  // Handle drag interactions
  const stack = useMemo(() => new PointerStack<Point | undefined>(2), []);
  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      const point = localPoint(event) ?? undefined;
      if (!stack.maybeAdd(event, point)) return;
      updateTooltip(stack.length < 2 ? point : undefined);
    },
    [stack, updateTooltip]
  );
  useWindowEvent('pointermove', (event) => {
    if (stack.length === 0 || !stack.has(event)) return;

    // Show tooltip if there is only one pointer
    const point = localPoint(event) ?? undefined;
    if (stack.length === 1) updateTooltip(point);

    // Get and update points
    const [lastPointA, lastPointB] = stack.getAll();
    stack.maybeUpdate(event, point);
    const [pointA, pointB] = stack.getAll();

    // Use euclidean distance instead of just
    // X-axis distance for more intuitive behavior
    const lastDistance = calcDistance(lastPointA, lastPointB);
    const distance = calcDistance(pointA, pointB);

    if (lastPointA === undefined || pointA === undefined) return;
    setView((oldView) =>
      pointerPanZoomView(
        oldView,
        timeScale.invert(lastPointA.x).getTime(),
        timeScale.invert(pointA.x).getTime(),
        lastPointB && timeScale.invert(lastPointB.x).getTime(),
        pointB && timeScale.invert(pointB.x).getTime(),
        lastDistance,
        distance,
        minSizeMs
      )
    );
  });
  useWindowEvent('pointerup', (event) => stack.maybeRemove(event));
  useWindowEvent('pointercancel', (event) => stack.maybeRemove(event));

  const handleHover = useCallback(
    (event: React.PointerEvent) => {
      if (stack.length > 0) return;
      updateTooltip(localPoint(event) ?? undefined);
    },
    [stack, updateTooltip]
  );
  const handleHoverEnd = useCallback(
    (event: React.PointerEvent) => {
      if (stack.length > 0 || event.pointerType !== 'mouse') return;
      hideTooltip();
    },
    [hideTooltip, stack]
  );

  const timeTicks = width / 140;
  return (
    <svg
      ref={containerRef}
      width={width}
      height={height}
      x={left}
      y={top}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerOver={handleHover}
      onPointerMove={handleHover}
      onPointerLeave={handleHoverEnd}
      onWheel={handleWheel}
      className="overflow-visible"
    >
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
      <GridColumns scale={timeScale} height={height} numTicks={timeTicks} stroke="#0002" />
      <LinePath
        data={data}
        x={(d) => timeScale(d[0])}
        y={(d) => wattScale(d[1])}
        stroke={LINE_COLOR}
      />
      <AxisBottom top={height} scale={timeScale} tickFormat={formatTime} numTicks={timeTicks} />
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
          <Circle cx={tooltipLeft} cy={wattScale(tooltipData[1])} r={3} />
          <Line y2={height} x1={tooltipLeft} x2={tooltipLeft} stroke="black" />
          <TooltipInPortal
            top={tooltipTop}
            left={tooltipLeft}
            className="text-center flex flex-col gap-1"
          >
            <b>{new Date(tooltipData[0]).toISOString()}</b>
            <div>{tooltipData[1].toExponential(5)} W/m²</div>
          </TooltipInPortal>
        </>
      )}
      {/* Invisible rect to catch interaction events. */}
      <rect width={width} height={height} fill="transparent" />
    </svg>
  );
}
