import { useFluxQuery } from '@/api/flux';
import { useQuery } from '@tanstack/react-query';
import { AxisTop } from '@visx/axis';
import { Brush } from '@visx/brush';
import BaseBrush from '@visx/brush/lib/BaseBrush';
import { GridColumns } from '@visx/grid';
import { scaleLog, scaleTime } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { PositionSizeProps } from './base';
import { LINE_COLOR, formatTime, timeExtent as calcTimeExtent, wattExtent, View } from './flux';

export interface FluxBrushRef {
  updateBrush(view: View): View;
}

export interface FluxBrushProps extends PositionSizeProps {
  onBrush?: (view: View) => void;
}

// eslint-disable-next-line prefer-arrow-callback
export default forwardRef<FluxBrushRef, FluxBrushProps>(function FluxBrush(
  { width, height, top, left, onBrush },
  ref
) {
  const { data } = useQuery(useFluxQuery(width));

  const timeExtent = useMemo(() => calcTimeExtent(data), [data]);
  const timeScale = useMemo(
    () =>
      scaleTime({
        range: [0, width],
        domain: timeExtent,
      }),
    [timeExtent, width]
  );

  const wattScale = useMemo(
    () =>
      scaleLog({
        // Don't go all the way down to prevent overlap with label
        range: [height - 15, 0],
        domain: wattExtent(data),
      }),
    [height, data]
  );

  const brushRef = useRef<BaseBrush | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      updateBrush(requested) {
        // Save reference to ensure safe access in callback
        const currentRef = brushRef.current;
        if (currentRef === null || timeExtent === undefined) return undefined;

        const actual =
          requested === undefined
            ? timeExtent
            : ([
                Math.max(timeExtent[0], requested[0]),
                Math.min(timeExtent[1], requested[1]),
              ] as const);

        if (actual[0] === timeExtent[0] && actual[1] === timeExtent[1]) currentRef.reset();
        else
          currentRef?.updateBrush((previous) => {
            const newExtent = currentRef.getExtent(
              { x: timeScale(actual[0]) },
              { x: timeScale(actual[1]) }
            );
            return {
              ...previous,
              start: { y: newExtent.y0, x: newExtent.x0 },
              end: { y: newExtent.y1, x: newExtent.x1 },
              extent: newExtent,
            };
          });

        return actual;
      },
    }),
    [timeExtent, timeScale]
  );

  // Only propagate onChange events if it is user initiated and not from updateBrush().
  const propagateEvents = useRef(false);
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
          onBrush?.(bounds === null ? undefined : [bounds.x0, bounds.x1]);
        }}
      />
    </svg>
  );
});
