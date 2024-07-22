import { useStableDebouncedFlux } from '@/api/flux';
import { AxisTop } from '@visx/axis';
import { GridColumns } from '@visx/grid';
import { scaleLog, scaleTime } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { useMemo } from 'react';
import { NumberRange } from '@/utils/range';
import { PositionSizeProps } from '../base';
import { LINE_COLOR, formatTime, wattExtent, View } from './flux';
import Brush from '../Brush';

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
        width={width}
        height={height}
        view={brushView}
        minSize={timeScale(range[0] + minSizeMs)}
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
