import { FluxMeasurement, useStableDebouncedFlux } from '@/api/flux';
import { AxisBottom, AxisLeft, TickRendererProps } from '@visx/axis';
import { localPoint } from '@visx/event';
import { GridColumns } from '@visx/grid';
import { scaleLog, scaleUtc } from '@visx/scale';
import { Circle, Line } from '@visx/shape';
import { useTooltip, useTooltipInPortal } from '@visx/tooltip';
import { bisector } from 'd3-array';
import { Dispatch, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NumberRange } from '@/utils/range';
import { panView, pointerPanZoomView, wheelZoomView } from '@/utils/panZoom';
import { Point } from '@visx/point';
import { PointerStack } from '@/utils/pointer';
import { useWindowEvent } from '@/utils/useWindowEvent';
import { colors, font, textSize } from '@/app/theme';
import { Text } from '@visx/text';
import { View, formatTime, formatWatt, timeExtent, wattExtent } from './flux';
import { PositionSizeProps } from '../base';
import Brush, { BrushView } from '../Brush';
import FlareClassBands from './FlareClassBands';
import FluxLine from './FluxLine';

function calcDistance(lastPointA: Point | undefined, lastPointB: Point | undefined) {
  return (
    lastPointA && lastPointB && Math.hypot(lastPointA.x - lastPointB.x, lastPointA.y - lastPointB.y)
  );
}

function shouldBrush(event: PointerEvent | React.PointerEvent): boolean {
  return event.pointerType !== 'touch' && event.button === 2;
}

function FluxTimeTickLabel({ y, formattedValue, ...rest }: TickRendererProps) {
  return formattedValue?.split(' ').map((line, index) => (
    <Text
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...rest}
      key={line}
      y={y + 16 * index}
      fill={colors.text.DEFAULT}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...textSize.xs}
    >
      {line}
    </Text>
  ));
}

interface FluxMainProps extends PositionSizeProps {
  onTimeSelect?: (timestamp: Date) => void;
  minSizeMs: number;
  lockWattAxis: boolean;
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
  lockWattAxis,
  view,
  setView,
}: FluxMainProps) {
  const data = useStableDebouncedFlux(view[0], view[1], width);
  const series = useMemo(() => data.flat(), [data])

  const timeScale = useMemo(
    () =>
      scaleUtc({
        range: [0, width],
        domain: view === undefined ? timeExtent(series) : Array.from(view),
      }),
    [series, view, width]
  );

  const wattScale = useMemo(
    () =>
      scaleLog({
        range: [height, 0],
        domain: lockWattAxis ? [1e-9, 1e-2] : wattExtent(series, 0.1),
        clamp: true,
      }),
    [height, lockWattAxis, series]
  );

  const { tooltipTop, tooltipLeft, tooltipData, showTooltip, hideTooltip } =
    useTooltip<FluxMeasurement>();
  const { containerRef: tooltipContainerRef, TooltipInPortal } = useTooltipInPortal();
  const [tooltipPoint, setTooltipPoint] = useState<Point | undefined>();
  useEffect(() => {
    if (tooltipPoint === undefined || data.length === 0) {
      hideTooltip();
      return;
    }
    const index = bisector<FluxMeasurement, number>((m) => m[0]).center(
      series,
      timeScale.invert(tooltipPoint.x).getTime()
    );
    const measurement = series[index];
    showTooltip({
      tooltipData: measurement,
      tooltipLeft: timeScale(measurement[0]),
      tooltipTop: tooltipPoint.y,
    });
  }, [data, hideTooltip, series, showTooltip, timeScale, tooltipPoint]);

  const handleClick = useCallback(
    (event: React.MouseEvent<SVGElement>) => {
      if (onTimeSelect === undefined) return;
      const point = localPoint(event);
      if (point === null) return;
      onTimeSelect(timeScale.invert(point.x));
    },
    [onTimeSelect, timeScale]
  );

  useWindowEvent(
    'wheel',
    (event) => {
      event.preventDefault();
      setView((current) => {
        const point = localPoint(event);
        if (point === null) return current;
        const currentOrDomain =
          current ?? (timeScale.domain().map((d) => d.getTime()) as NumberRange);
        const zoomed = wheelZoomView(
          currentOrDomain,
          event.deltaY,
          timeScale.invert(point.x).getTime(),
          minSizeMs
        );

        const panDelta = timeScale.invert(event.deltaX).getTime() - view[0];
        return panView(zoomed, panDelta);
      });
    },
    { passive: false }
  );

  // Handle drag interactions
  const containerRef = useRef<SVGSVGElement>(null);
  const stack = useMemo(() => new PointerStack<Point | undefined>(2), []);
  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (shouldBrush(event)) return;
      const point = localPoint(event) ?? undefined;
      if (!stack.maybeAdd(event, point)) return;
      setTooltipPoint(stack.length < 2 ? point : undefined);
    },
    [stack]
  );
  useWindowEvent('pointermove', (event) => {
    if (containerRef.current === null || stack.length === 0 || !stack.has(event)) return;

    // Show tooltip if there is only one pointer
    const point = localPoint(containerRef.current, event) ?? undefined;
    if (stack.length === 1) setTooltipPoint(point);

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
      setTooltipPoint(localPoint(event) ?? undefined);
    },
    [stack]
  );
  const handleHoverEnd = useCallback(
    (event: React.PointerEvent) => {
      if (stack.length > 0 || event.pointerType !== 'mouse') return;
      setTooltipPoint(undefined);
    },
    [stack]
  );

  const [zoomBrush, setZoomBrush] = useState<BrushView>(undefined);

  const timeTicks = Math.max(width / 160, 2);
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
      className="overflow-visible"
    >
      {/* Needs to reference child svg because of browser
          inconsistencies use-measure does not account for. */}
      <svg ref={tooltipContainerRef} />
      <FlareClassBands width={width} height={height} scale={wattScale} />
      <GridColumns scale={timeScale} height={height} numTicks={timeTicks} stroke={colors.bg[1]} />
      <FluxLine data={data} timeScale={timeScale} wattScale={wattScale} />
      <rect width={width} height={height} fill="transparent" className="stroke-bg-2" />
      <AxisBottom
        top={height}
        scale={timeScale}
        label="Universal Time"
        tickFormat={formatTime}
        tickComponent={FluxTimeTickLabel}
        numTicks={timeTicks}
        stroke={colors.text.DEFAULT}
        tickStroke={colors.text.DEFAULT}
        labelOffset={40}
        labelProps={{ fill: colors.text.DEFAULT, ...textSize.sm, ...font.style }}
      />
      <AxisLeft
        scale={wattScale}
        label="Watts × m⁻²"
        tickFormat={formatWatt}
        stroke={colors.text.DEFAULT}
        tickStroke={colors.text.DEFAULT}
        tickLabelProps={{ fill: colors.text.DEFAULT, ...textSize.sm, ...font.style }}
        labelOffset={lockWattAxis ? 40 : 72}
        labelProps={{ fill: colors.text.DEFAULT, ...textSize.sm, ...font.style }}
      />
      {tooltipData && (
        <>
          <Line y2={height} x1={tooltipLeft} x2={tooltipLeft} className="stroke-text" />
          <Circle cx={tooltipLeft} cy={wattScale(tooltipData[1])} r={3} className="fill-text" />
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
      <Brush
        width={width}
        height={height}
        view={zoomBrush}
        pointerFilter={shouldBrush}
        onBrush={setZoomBrush}
        onBrushEnd={(zoomView) => {
          setZoomBrush(undefined);
          if (zoomView === undefined) return;
          setView(() => [
            timeScale.invert(zoomView[0]).getTime(),
            timeScale.invert(zoomView[1]).getTime(),
          ]);
        }}
      />
    </svg>
  );
}
