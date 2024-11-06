import { useStableDebouncedFlux } from '@/api/flux/useFlux';
import { GridColumns } from '@visx/grid';
import { scaleLog, scaleUtc } from '@visx/scale';
import { useMemo } from 'react';
import { THEME } from '@/app/theme';
import { PositionSizeProps } from '@/components/svg/base';
import Brush from '@/components/svg/Brush';
import { Line } from '@visx/shape';
import { calcTimeTicks, formatDateTick, MAX_WATT_EXTENT, MemoAxisTop } from './utils';
import FluxLine from './FluxLine';
import { usePlayerState, usePlayerRenderState } from '../state/state';
import { MIN_VIEW_SIZE_MS } from '../state/settings';

const AXIS_LABEL_PROPS = {
  ...THEME.textSize.xs,
  ...THEME.font.style,
  fill: THEME.colors.text.DEFAULT,
  filter: 'url(#label-backdrop)',
};
const CHART_Y_PADDING = 2;
const BACKDROP_PADDING = 0.15;
const BACKDROP_BLUR_RADIUS = 0.2;

const backdropFilterOffset = -BACKDROP_PADDING - BACKDROP_BLUR_RADIUS;
const backdropFilterSize = 1 + 2 * BACKDROP_PADDING + 2 * BACKDROP_BLUR_RADIUS;
const backdropFloodOffset = -BACKDROP_PADDING;
const backdropFloodSize = 1 + 2 * BACKDROP_PADDING;

export default function BrushChart({ width, height, top, left }: PositionSizeProps) {
  const state = usePlayerState();
  const { range, view, timestamp } = usePlayerRenderState();
  const data = useStableDebouncedFlux(range[0], range[1], width);

  const timeScale = useMemo(
    () =>
      scaleUtc({
        range: [0, width],
        domain: Array.from(range),
      }),
    [range, width]
  );
  const wattScale = useMemo(
    () =>
      scaleLog({
        range: [height - 2 * CHART_Y_PADDING, CHART_Y_PADDING],
        domain: MAX_WATT_EXTENT,
        clamp: true,
      }),
    [height]
  );

  const cursorX = useMemo(() => timeScale(timestamp), [timeScale, timestamp]);
  const timeTicks = calcTimeTicks(width);
  return (
    <svg width={width} height={height} y={top} x={left} className="overflow-visible">
      {/* Background */}
      <GridColumns
        scale={timeScale}
        height={height}
        numTicks={timeTicks}
        stroke={THEME.colors.bg[1]}
      />

      {/* Data */}
      <FluxLine data={data} timeScale={timeScale} wattScale={wattScale} />

      {/* Borders */}
      <rect width={width} height={height} fill="transparent" className="stroke-bg-2" />

      {/* Current view and timestamp */}
      <Line y1={0} y2={height} x1={cursorX} x2={cursorX} className="stroke-primary" />
      <Brush
        width={width}
        height={height}
        view={[timeScale(view[0]), timeScale(view[1])]}
        minSize={timeScale(range[0] + MIN_VIEW_SIZE_MS)}
        allowOverflow
        clickViewSize={30}
        onBrushStart={(isDrawingNew) => {
          if (!isDrawingNew) return;
          state.setView(state.view(), true);
        }}
        onBrush={(newView) =>
          state.setView(
            newView === undefined
              ? range
              : [timeScale.invert(newView[0]).getTime(), timeScale.invert(newView[1]).getTime()]
          )
        }
      />

      {/* Axis */}
      <defs>
        <filter
          id="label-backdrop"
          x={backdropFilterOffset}
          y={backdropFilterOffset}
          width={backdropFilterSize}
          height={backdropFilterSize}
          primitiveUnits="objectBoundingBox"
        >
          <feFlood
            x={backdropFloodOffset}
            y={backdropFloodOffset}
            width={backdropFloodSize}
            height={backdropFloodSize}
            floodColor={THEME.colors.bg.DEFAULT}
            floodOpacity={0.5}
          />
          <feGaussianBlur
            x={backdropFilterOffset}
            y={backdropFilterOffset}
            width={backdropFilterSize}
            height={backdropFilterSize}
            stdDeviation={BACKDROP_BLUR_RADIUS}
            result="backdrop"
          />
          <feMerge>
            <feMergeNode in="backdrop" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <MemoAxisTop
        top={height}
        scale={timeScale}
        tickFormat={formatDateTick}
        numTicks={timeTicks}
        hideTicks
        tickLength={0}
        stroke={THEME.colors.text.DEFAULT}
        tickStroke={THEME.colors.text.DEFAULT}
        tickLabelProps={AXIS_LABEL_PROPS}
      />
    </svg>
  );
}
