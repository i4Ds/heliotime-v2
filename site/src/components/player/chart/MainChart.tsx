import { FluxMeasurement } from '@/api/flux/data';
import { TickLabelProps } from '@visx/axis';
import { localPoint } from '@visx/event';
import { scaleLog, scaleUtc } from '@visx/scale';
import { Circle, Line } from '@visx/shape';
import { useTooltipInPortal } from '@visx/tooltip';
import { bisector } from 'd3-array';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { panView, pointerPanZoomView, wheelZoomView } from '@/utils/panZoom';
import { Point } from '@visx/point';
import { PointerStack } from '@/utils/pointer';
import { useWindowEvent } from '@/utils/window';
import { THEME, toPx } from '@/app/theme';
import { TextProps } from '@visx/text';
import { useStableDebouncedFlux } from '@/api/flux/useFlux';
import Brush, { BrushView } from '@/components/svg/Brush';
import { applyMargin, PositionSizeProps } from '@/components/svg/base';
import { TextRect } from '@/components/svg/TextRect';
import {
  calcTimeTicks,
  formatTimeCursor,
  formatTimeTick,
  formatWattTick,
  MAX_WATT_EXTENT,
  MemoAxisBottom,
  MemoAxisLeft,
  MemoGridColumns,
  wattExtent,
} from './utils';
import FlareClassBands from './FlareClassBands';
import FluxLine from './FluxLine';
import { usePlayerRenderState, usePlayerState } from '../state/state';
import { MIN_VIEW_SIZE_MS, usePlayerSettings } from '../state/settings';

const TICK_LENGTH = THEME.spacePx(2);
const TICK_LABEL_PADDING = THEME.spacePx(1);
const AXIS_LABEL_PROPS = {
  ...THEME.textSize.sm,
  ...THEME.font.style,
  fill: THEME.colors.text.DEFAULT,
} satisfies TextProps;
const WATT_TICK_LABEL_PROPS = {
  ...AXIS_LABEL_PROPS,
  ...THEME.textSize.xs,
  dx: 0,
  x: -TICK_LENGTH - TICK_LABEL_PADDING,
} satisfies TickLabelProps<unknown>;
const TIME_TICK_LABEL_PROPS = {
  ...AXIS_LABEL_PROPS,
  ...THEME.textSize.xs,
  verticalAnchor: 'start',
  textAnchor: 'middle',
  y: TICK_LENGTH + TICK_LABEL_PADDING,
  // Set to 0 because axis sets it to strange values
  dy: 0,
  // Set to 1 to force the text to wrap
  width: 1,
} satisfies TickLabelProps<unknown>;

function calcDistance(lastPointA: Point | undefined, lastPointB: Point | undefined) {
  return (
    lastPointA && lastPointB && Math.hypot(lastPointA.x - lastPointB.x, lastPointA.y - lastPointB.y)
  );
}

function shouldBrush(event: PointerEvent | React.PointerEvent): boolean {
  return event.pointerType !== 'touch' && event.button === 2;
}

export function MainChart(props: PositionSizeProps) {
  const { view, timestamp } = usePlayerRenderState();
  const state = usePlayerState();
  const [settings] = usePlayerSettings();

  const timeLabelOffset = 40;
  const wattLabelOffset = settings.lockWattAxis ? 40 : 70;
  const { width, height, top, left } = useMemo(
    () =>
      applyMargin(props, {
        left: wattLabelOffset + 20,
        right: 48,
        bottom: timeLabelOffset + 20,
      }),
    [props, wattLabelOffset, timeLabelOffset]
  );

  const data = useStableDebouncedFlux(view[0], view[1], width);
  const series = useMemo(() => data.flat(), [data]);

  const timeScale = useMemo(
    () =>
      scaleUtc({
        range: [0, width],
        domain: Array.from(view),
      }),
    [view, width]
  );
  // Series should only be in the dependency array if the scale isn't locked.
  // Wrangle into single variable to allow for static checking.
  const wattDomain = settings.lockWattAxis || series;
  const wattScale = useMemo(
    () =>
      scaleLog({
        range: [height, 0],
        domain: typeof wattDomain === 'boolean' ? MAX_WATT_EXTENT : wattExtent(wattDomain, 0.1),
        clamp: true,
      }),
    [height, wattDomain]
  );

  const { containerRef: tooltipContainerRef, TooltipInPortal } = useTooltipInPortal();
  // Force recalculation of tooltip position. Bug in visx.
  useEffect(() => {
    globalThis.dispatchEvent(new Event('resize'));
  }, [settings.showPreview]);
  const [hoverPoint, setHoverPoint] = useState<Point | undefined>();
  const hoverMeasurement = useMemo(() => {
    if (hoverPoint === undefined || series.length === 0) return undefined;
    const index = bisector<FluxMeasurement, number>((m) => m[0]).center(
      series,
      timeScale.invert(hoverPoint.x).getTime()
    );
    const measurement = series[index];
    return {
      time: new Date(measurement[0]),
      value: measurement[1],
      x: timeScale(measurement[0]),
      y: wattScale(measurement[1]),
    };
  }, [hoverPoint, series, timeScale, wattScale]);

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      const point = localPoint(event);
      if (point === null) return;
      const zoomed = wheelZoomView(
        state.view(),
        event.deltaY,
        timeScale.invert(point.x).getTime(),
        MIN_VIEW_SIZE_MS
      );

      const panDelta = timeScale.invert(event.deltaX).getTime() - view[0];
      state.setView(panView(zoomed, panDelta));
    },
    [state, timeScale, view]
  );

  // Handle drag & click interactions
  const containerRef = useRef<SVGSVGElement>(null);
  const stack = useMemo(() => new PointerStack<Point | undefined>(2), []);
  const clickPointerId = useRef<number | undefined>(undefined);
  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (shouldBrush(event)) return;
      const point = localPoint(event) ?? undefined;
      if (!stack.maybeAdd(event, point)) return;
      setHoverPoint(stack.length < 2 ? point : undefined);
      if (stack.length === 1) clickPointerId.current = event.pointerId;
    },
    [stack]
  );
  useWindowEvent('pointermove', (event) => {
    if (containerRef.current === null || stack.length === 0 || !stack.has(event)) return;

    // Moving the mouse cancels the click
    clickPointerId.current = undefined;

    // Show tooltip if there is only one pointer
    const point = localPoint(containerRef.current, event) ?? undefined;
    if (stack.length === 1) setHoverPoint(point);

    // Get and update points
    const [lastPointA, lastPointB] = stack.getAll();
    stack.maybeUpdate(event, point);
    const [pointA, pointB] = stack.getAll();

    // Use euclidean distance instead of just
    // X-axis distance for more intuitive behavior
    const lastDistance = calcDistance(lastPointA, lastPointB);
    const distance = calcDistance(pointA, pointB);

    if (lastPointA === undefined || pointA === undefined) return;
    state.setView(
      pointerPanZoomView(
        state.view(),
        timeScale.invert(lastPointA.x).getTime(),
        timeScale.invert(pointA.x).getTime(),
        lastPointB && timeScale.invert(lastPointB.x).getTime(),
        pointB && timeScale.invert(pointB.x).getTime(),
        lastDistance,
        distance,
        MIN_VIEW_SIZE_MS
      )
    );
  });
  const handlePointerEnd = (event: PointerEvent) => {
    if (!stack.maybeRemove(event)) return;

    // Maybe handle click
    if (stack.length > 0 || clickPointerId.current !== event.pointerId) return;
    const point = localPoint(event);
    if (point === null) return;
    state.setTimestamp(timeScale.invert(point.x).getTime());
    clickPointerId.current = undefined;
  };
  useWindowEvent('pointerup', handlePointerEnd);
  useWindowEvent('pointercancel', handlePointerEnd);

  const handleHover = useCallback(
    (event: React.PointerEvent) => {
      if (stack.length > 0) return;
      setHoverPoint(localPoint(event) ?? undefined);
    },
    [stack]
  );
  const handleHoverEnd = useCallback(
    (event: React.PointerEvent) => {
      if (stack.length > 0 || event.pointerType !== 'mouse') return;
      setHoverPoint(undefined);
    },
    [stack]
  );

  const [zoomBrush, setZoomBrush] = useState<BrushView>(undefined);

  const desiredTimeTicks = calcTimeTicks(width);
  const intervalMsEstimate = (view[1] - view[0]) / desiredTimeTicks;

  const cursorX = timeScale(timestamp);
  const cursorLabel = useMemo(
    () => formatTimeCursor(timestamp, intervalMsEstimate),
    [timestamp, intervalMsEstimate]
  );

  return (
    <svg
      ref={containerRef}
      width={width}
      height={height}
      x={left}
      y={top}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerOver={handleHover}
      onPointerMove={handleHover}
      onPointerLeave={handleHoverEnd}
      className="overflow-visible"
    >
      {/* Needs to reference child svg because of browser
          inconsistencies use-measure does not account for. */}
      <svg ref={tooltipContainerRef} />

      {/* Background */}
      <FlareClassBands width={width} height={height} scale={wattScale} />
      <MemoGridColumns
        scale={timeScale}
        height={height}
        numTicks={desiredTimeTicks}
        stroke={THEME.colors.bg[1]}
      />

      {/* Data */}
      <FluxLine data={data} timeScale={timeScale} wattScale={wattScale} />

      {/* Border */}
      <rect width={width} height={height} fill="transparent" className="stroke-bg-2" />

      {/* Tooltip */}
      {hoverPoint && (
        <Line y2={height} x1={hoverPoint.x} x2={hoverPoint.x} className="stroke-text" />
      )}
      {hoverMeasurement && (
        <>
          <Circle cx={hoverMeasurement.x} cy={hoverMeasurement.y} r={3} className="fill-text" />
          <TooltipInPortal
            left={hoverMeasurement.x}
            top={hoverMeasurement.y}
            className="text-center flex flex-col gap-1"
          >
            <b>{hoverMeasurement.time.toISOString()}</b>
            <div>{hoverMeasurement.value.toExponential(5)} W/m²</div>
          </TooltipInPortal>
        </>
      )}

      {/* Brush */}
      <Brush
        width={width}
        height={height}
        view={zoomBrush}
        pointerFilter={shouldBrush}
        onBrush={setZoomBrush}
        onBrushEnd={(zoomView) => {
          setZoomBrush(undefined);
          if (zoomView === undefined) return;
          state.setView(
            [timeScale.invert(zoomView[0]).getTime(), timeScale.invert(zoomView[1]).getTime()],
            true
          );
        }}
      />

      {/* Axis */}
      <MemoAxisBottom
        top={height}
        scale={timeScale}
        label="Universal Time"
        tickFormat={formatTimeTick}
        numTicks={desiredTimeTicks}
        stroke={THEME.colors.text.DEFAULT}
        tickLength={TICK_LENGTH}
        tickStroke={THEME.colors.text.DEFAULT}
        tickLabelProps={TIME_TICK_LABEL_PROPS}
        labelOffset={timeLabelOffset}
        labelProps={AXIS_LABEL_PROPS}
      />
      <MemoAxisLeft
        scale={wattScale}
        label="Watts × m⁻²"
        tickFormat={formatWattTick}
        stroke={THEME.colors.text.DEFAULT}
        tickLength={TICK_LENGTH}
        tickStroke={THEME.colors.text.DEFAULT}
        tickLabelProps={WATT_TICK_LABEL_PROPS}
        labelOffset={wattLabelOffset}
        labelProps={AXIS_LABEL_PROPS}
      />

      {/* Cursor */}
      {cursorX > 0 && cursorX < width && (
        <>
          <Line
            y1={0}
            y2={height + TICK_LENGTH + TICK_LABEL_PADDING}
            x1={cursorX}
            x2={cursorX}
            className="stroke-primary"
          />
          <TextRect
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...TIME_TICK_LABEL_PROPS}
            x={cursorX}
            y={height + TIME_TICK_LABEL_PROPS.y}
            fill={THEME.colors.bg.DEFAULT}
            rectClassName="fill-primary"
            padding={TICK_LABEL_PADDING}
            // Label does not have any characters like g going below the baseline.
            // So we can remove the space from the bottom.
            paddingBottom={TICK_LABEL_PADDING - toPx(TIME_TICK_LABEL_PROPS.fontSize) * 0.3}
          >
            {cursorLabel}
          </TextRect>
        </>
      )}
    </svg>
  );
}
