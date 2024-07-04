import { FluxMeasurement, FluxSeries, selectFlux, useFluxQuery } from '@/api/flux';
import { HorizontalBand } from '@/chart/HorizontalBand';
import { toSuperScript } from '@/utils/super';
import { useQuery } from '@tanstack/react-query';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { localPoint } from '@visx/event';
import { GridColumns } from '@visx/grid';
import { scaleLog, scaleTime } from '@visx/scale';
import { Circle, Line, LinePath } from '@visx/shape';
import { useTooltip, useTooltipInPortal } from '@visx/tooltip';
import { bisector } from 'd3-array';
import { Dispatch, useCallback, useMemo } from 'react';
import { NumberRange } from '@/utils/range';
import { zoomView } from '@/utils/zoom';
import { useDebounce } from 'use-debounce';
import { PositionSizeProps } from './base';
import { LINE_COLOR, View, formatTime, timeExtent, wattExtent } from './flux';

function useDebouncedFluxQuery(
  view: View,
  width: number,
  delayMs = 500,
  maxWaitMs = 200
): FluxSeries | undefined {
  const [debouncedView] = useDebounce(view, delayMs, { leading: true, maxWait: maxWaitMs });
  const { data } = useQuery(useFluxQuery(width, debouncedView?.[0], debouncedView?.[1], true));
  return useMemo(
    () => (data === undefined ? undefined : selectFlux(data, view?.[0], view?.[1])),
    [data, view]
  );
}

interface FluxMainProps extends PositionSizeProps {
  onTimeSelect?: (timestamp: Date) => void;
  view: View;
  setView: Dispatch<(previous: View) => View>;
}

export function FluxMain({
  width,
  height,
  top = 0,
  left = 0,
  onTimeSelect,
  view,
  setView,
}: FluxMainProps) {
  const data = useDebouncedFluxQuery(view, width);

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

  const { tooltipTop, tooltipLeft, tooltipData, showTooltip, hideTooltip } =
    useTooltip<FluxMeasurement>();
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
        tooltipData: measurement,
        tooltipLeft: timeScale(measurement[0]),
        tooltipTop: point.y,
      });
    },
    [data, hideTooltip, showTooltip, timeScale]
  );

  const handleZoom = useCallback(
    (event: React.WheelEvent<SVGElement>) =>
      setView((current) => {
        const point = localPoint(event);
        if (point === null) return current;
        const currentOrDomain =
          current ?? (timeScale.domain().map((d) => d.getTime()) as NumberRange);
        return zoomView(currentOrDomain, event.deltaY, {
          focus: timeScale.invert(point.x).getTime(),
          minRange: 5 * 60 * 1000,
        });
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
          <Circle cx={tooltipLeft} cy={wattScale(tooltipData[1])} r={3} />
          <Line y2={height} x1={tooltipLeft} x2={tooltipLeft} stroke="black" />
          <TooltipInPortal top={tooltipTop} left={tooltipLeft} className='text-center flex flex-col gap-1'>
            <b>{new Date(tooltipData[0]).toISOString()}</b>
            <div>{tooltipData[1].toExponential(5)} W/m²</div>
          </TooltipInPortal>
        </>
      )}
    </svg>
  );
}
