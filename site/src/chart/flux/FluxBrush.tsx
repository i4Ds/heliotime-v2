import { useStableDebouncedFlux } from '@/api/flux';
import { AxisTop } from '@visx/axis';
import { GridColumns } from '@visx/grid';
import { scaleLog, scaleUtc } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { useMemo } from 'react';
import { NumberRange } from '@/utils/range';
import { colors, font, textSize } from '@/app/theme';
import { curveMonotoneX } from '@visx/curve';
import { PositionSizeProps } from '../base';
import { wattExtent, View, formatTimeOnlyDate } from './flux';
import Brush from '../Brush';

const CHART_Y_PADDING = 2;
const BACKDROP_PADDING = 0.15;
const BACKDROP_BLUR_RADIUS = 0.2;

const backdropFilterOffset = -BACKDROP_PADDING - BACKDROP_BLUR_RADIUS;
const backdropFilterSize = 1 + 2 * BACKDROP_PADDING + 2 * BACKDROP_BLUR_RADIUS;
const backdropFloodOffset = -BACKDROP_PADDING;
const backdropFloodSize = 1 + 2 * BACKDROP_PADDING;

export interface FluxBrushProps extends PositionSizeProps {
  range: NumberRange;
  view: View;
  minSizeMs: number;
  onBrush: (view: View) => void;
}

// eslint-disable-next-line prefer-arrow-callback
export default function FluxBrush({
  width,
  height,
  top,
  left,
  range,
  view,
  minSizeMs,
  onBrush,
}: FluxBrushProps) {
  const data = useStableDebouncedFlux(range[0], range[1], width);

  const timeScale = useMemo(
    () =>
      scaleUtc({
        range: [0, width],
        domain: range,
      }),
    [range, width]
  );

  const wattScale = useMemo(
    () =>
      scaleLog({
        range: [height - 2 * CHART_Y_PADDING, CHART_Y_PADDING],
        domain: wattExtent(data, 0.05),
        clamp: true,
      }),
    [height, data]
  );

  const brushView = useMemo(() => {
    const converted = [timeScale(view[0]), timeScale(view[1])] as const;
    return converted[0] === 0 && converted[1] === width ? undefined : converted;
  }, [timeScale, view, width]);
  return (
    <svg width={width} height={height} y={top} x={left} className="overflow-visible">
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
            floodColor={colors.bg.DEFAULT}
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
      <GridColumns scale={timeScale} height={height} numTicks={8} stroke={colors.bg[1]} />
      <LinePath
        curve={curveMonotoneX}
        data={data}
        x={(d) => timeScale(d[0])}
        y={(d) => wattScale(d[1])}
        stroke={colors.primary.DEFAULT}
      />
      <rect width={width} height={height} fill="transparent" className="stroke-bg-2" />
      <AxisTop
        top={height}
        scale={timeScale}
        tickFormat={formatTimeOnlyDate}
        numTicks={8}
        hideTicks
        tickLength={0}
        stroke={colors.text.DEFAULT}
        tickStroke={colors.text.DEFAULT}
        tickLabelProps={{
          fill: colors.text.DEFAULT,
          ...textSize.xs,
          ...font.style,
          filter: 'url(#label-backdrop)',
        }}
      />
      <Brush
        width={width}
        height={height}
        view={brushView}
        minSize={timeScale(range[0] + minSizeMs)}
        allowOverflow
        clickViewSize={30}
        onBrush={(newView) =>
          onBrush(
            newView === undefined
              ? range
              : [timeScale.invert(newView[0]).getTime(), timeScale.invert(newView[1]).getTime()]
          )
        }
      />
    </svg>
  );
}
