import { useCallback, useEffect, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { useQuery } from '@tanstack/react-query';
import { useFluxRangeQuery } from '@/api/flux';
import { NumberRange } from '@/utils/range';
import { limitView } from '@/utils/panZoom';
import { FluxMain } from './FluxMain';
import FluxBrush from './FluxBrush';
import { View } from './flux';

const LIVE_INTERVAL_MS = 200;
const FOLLOW_THRESHOLD_MS = 500;
const MIN_VIEW_SIZE_MS = 5 * 60 * 1000;

export interface FluxChartProps {
  className?: string;
  onTimeSelect?: (timestamp: Date) => void;
}

export default function FluxChart({ className, onTimeSelect }: FluxChartProps) {
  const { data: dataRange } = useQuery(useFluxRangeQuery());
  const [range, setRange] = useState<NumberRange>(dataRange ?? [0, 0]);
  const [view, setView] = useState<View>(range);
  const setFollowView = useCallback(
    (viewSize: number) => {
      setView([range[1] - viewSize, range[1]]);
    },
    [range, setView]
  );
  const panFollowView = useCallback(() => {
    if (view === undefined) return;
    setFollowView(view[1] - view[0]);
  }, [setFollowView, view]);

  // Follow live time
  const shouldFollowStart = range[1] - FOLLOW_THRESHOLD_MS < view[1];
  useEffect(() => {
    const interval = setInterval(() => {
      const newRange: NumberRange = [dataRange?.[0] ?? 0, Date.now()];
      const shouldFollowEnd = view[0] === range[0];
      // Prevent brush jitter
      if (shouldFollowStart || shouldFollowEnd)
        setView([
          shouldFollowEnd ? newRange[0] : view[0],
          shouldFollowStart ? newRange[1] : view[1],
        ]);
      setRange(newRange);
      // TODO: adjust refresh rate based on view and range size
    }, LIVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [dataRange, panFollowView, range, setView, shouldFollowStart, view]);

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <div className="flex gap-2 px-3">
        {(
          [
            ['1H', 1 * 60 * 60 * 1000],
            ['1D', 24 * 60 * 60 * 1000],
            ['1W', 7 * 24 * 60 * 60 * 1000],
            ['1M', 30 * 24 * 60 * 60 * 1000],
            ['1Y', 365 * 24 * 60 * 60 * 1000],
          ] as const
        )
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .filter(([_, viewSize]) => range[1] - range[0] > viewSize)
          .map(([label, viewSize]) => (
            <button key={label} type="button" onClick={() => setFollowView(viewSize)}>
              {label}
            </button>
          ))}
        <button type="button" onClick={() => setView(range)}>
          All
        </button>
        <button
          className={`ml-auto ${shouldFollowStart ? 'btn-invert' : ''}`}
          type="button"
          onClick={() => panFollowView()}
        >
          -&gt;
        </button>
      </div>
      <div className="flex-grow px-1 md:px-3">
        <ParentSize>
          {({ width, height }) => {
            const brushHeight = height * 0.15;
            const mainLeftMargin = 70;
            return (
              <svg
                width={width}
                height={height}
                className="select-none touch-none overflow-visible absolute"
                onContextMenuCapture={(event) => event.preventDefault()}
              >
                <FluxMain
                  width={width - mainLeftMargin}
                  height={height - brushHeight - 60}
                  left={mainLeftMargin}
                  view={view}
                  minSizeMs={MIN_VIEW_SIZE_MS}
                  setView={(setter) => setView((previous) => limitView(setter(previous), range))}
                  onTimeSelect={onTimeSelect}
                />
                <FluxBrush
                  width={width}
                  height={brushHeight}
                  top={height - brushHeight}
                  range={range}
                  view={view}
                  minSizeMs={MIN_VIEW_SIZE_MS}
                  onBrush={(newView) => setView(newView)}
                />
              </svg>
            );
          }}
        </ParentSize>
      </div>
    </div>
  );
}
