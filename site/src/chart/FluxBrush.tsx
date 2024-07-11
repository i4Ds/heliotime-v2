import { useFluxQuery } from '@/api/flux';
import { useQuery } from '@tanstack/react-query';
import { AxisTop } from '@visx/axis';
import { Brush } from '@visx/brush';
import BaseBrush from '@visx/brush/lib/BaseBrush';
import { GridColumns } from '@visx/grid';
import { scaleLog, scaleTime } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { NumberRange } from '@/utils/range';
import { PositionSizeProps } from './base';
import { LINE_COLOR, formatTime, timeExtent, wattExtent, View } from './flux';

export interface FluxBrushRef {
  updateBrush(view: View): void;
}

export interface FluxBrushProps extends PositionSizeProps {
  range: NumberRange;
  onBrush?: (view: View) => void;
  onBrushStart?: () => void;
  onBrushEnd?: () => void;
}

// eslint-disable-next-line prefer-arrow-callback
export default forwardRef<FluxBrushRef, FluxBrushProps>(function FluxBrush(
  { width, height, top, left,range,  onBrush, onBrushEnd, onBrushStart },
  ref
) {
  const { data } = useQuery(useFluxQuery(width, range[0], range[1]));

  const timeScale = useMemo(
    () =>
      scaleTime({
        range: [0, width],
        domain: range,
      }),
    [range, width]
  );

  const wattScale = useMemo(
    () =>
      scaleLog({
        // Don't go all the way down to prevent overlap with label
        range: [height - 15, 0],
        domain: wattExtent(data),
        clamp: true
      }),
    [height, data]
  );

  const brushRef = useRef<BaseBrush | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      updateBrush(view) {
        // Save reference to ensure safe access in callback
        const currentRef = brushRef.current;
        if (currentRef === null || timeExtent === undefined) return;
        if (
          view === undefined ||
          // Full brush is equivalent to no brush at all
          (view[0] === range[0] && view[1] === range[1])
        ) {
          currentRef.reset();
          return;
        }
        currentRef?.updateBrush((previous) => {
          const newExtent = currentRef.getExtent(
            { x: timeScale(view[0]) },
            { x: timeScale(view[1]) }
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
    [range, timeScale]
  );

  // Only propagate onChange events if it is user initiated and not from updateBrush().
  const propagateEvents = useRef(false);
  // Clean up start and end events
  const firstChange = useRef(true);
  const firstEnd = useRef(true);
  return (
    <svg
      width={width}
      height={height}
      y={top}
      x={left}
      onMouseEnter={() => {
        propagateEvents.current = true;
      }}
      onMouseLeave={() => {
        propagateEvents.current = false;
      }}
    >
      <GridColumns scale={timeScale} height={height} numTicks={8} stroke="#0002" />
      <LinePath
        data={data}
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
          if (!propagateEvents.current) return;
          if (firstChange.current) {
            firstChange.current = false;
            onBrushStart?.();
          }
          firstEnd.current = true;
          onBrush?.(bounds === null ? range : [bounds.x0, bounds.x1]);
        }}
        onBrushEnd={() => {
          if (!firstEnd.current) return;
          // Must be set in next cycle because onChange still gonna execute
          setTimeout(() => {
            firstChange.current = true;
          });
          firstEnd.current = false;
          onBrushEnd?.();
        }}
      />
    </svg>
  );
});
