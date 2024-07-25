import { useCallback, useEffect } from 'react';
import { useParentSize } from '@visx/responsive';
import { useQuery } from '@tanstack/react-query';
import { useFluxRangeQuery } from '@/api/flux';
import { NumberRange } from '@/utils/range';
import { limitView, panView } from '@/utils/panZoom';
import { useVolatileState } from '@/utils/useVolatile';
import { FluxMain } from './FluxMain';
import FluxBrush from './FluxBrush';
import { View } from './flux';

const FOLLOW_FRONTRUN_PERCENT = 0.1;
const MIN_VIEW_SIZE_MS = 5 * 60 * 1000;

export interface FluxChartProps {
  className?: string;
  onTimeSelect?: (timestamp: Date) => void;
}

export default function FluxChart({ className, onTimeSelect }: FluxChartProps) {
  const { parentRef, width, height } = useParentSize();
  const brushHeight = height * 0.15;
  const mainLeftMargin = 100;

  const [renderRange, getRange, setRange] = useVolatileState<NumberRange>([0, 0]);
  const [renderView, getView, setRawView] = useVolatileState<View>(renderRange);
  const [renderIsFollowing, getIsFollowing, setIsFollowing] = useVolatileState(true);
  const setView = useCallback(
    (newView: View) => {
      const view = getView();
      const range = getRange();
      // If view moved out of live part
      if (newView[1] < range[1]) setIsFollowing(false);
      // If view newly moved into live part (only newly to allow disabling following)
      if (view[1] < range[1] && newView[1] > range[1]) setIsFollowing(true);
      setRawView(newView);
    },
    [getRange, getView, setIsFollowing, setRawView]
  );
  const setFollowView = useCallback(
    (viewSize: number) => {
      const frontrun = Date.now() + FOLLOW_FRONTRUN_PERCENT * viewSize;
      setView([frontrun - viewSize, frontrun]);
    },
    [setView]
  );
  const panFollowView = useCallback(() => {
    const view = getView();
    setFollowView(view[1] - view[0]);
  }, [getView, setFollowView]);
  const setLimitedView = useCallback(
    (newView: View) => {
      const range = getRange();
      const overflow = Math.min(newView[1] - newView[0], range[1] - range[0]);
      setView(limitView(newView, [range[0] - overflow, range[1] + overflow], MIN_VIEW_SIZE_MS));
    },
    [getRange, setView]
  );

  // Set default view to 1 day look back
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setFollowView(24 * 60 * 60 * 1000), []);

  // Update end with server reported end date
  const { data: dataRange } = useQuery(useFluxRangeQuery());
  useEffect(() => {
    if (dataRange === undefined) return;
    setRange([dataRange[0], Date.now()]);
    // Reapply limits to view incase range got smaller
    setLimitedView(getView());
  }, [dataRange, getRange, getView, setLimitedView, setRange]);

  // Follow live time
  const intervalMs = Math.max(
    // Round interval to no recreate the interval too often
    2 ** Math.ceil(Math.log2((renderView[1] - renderView[0]) / width / 2)),
    100
  );
  useEffect(() => {
    // Update range first to ensure correct delta calculation
    setRange([getRange()[0], Date.now()]);
    const interval = setInterval(() => {
      const range = getRange();
      const newEnd = Date.now();
      if (getIsFollowing()) setView(panView(getView(), newEnd - range[1]));
      setRange([range[0], newEnd]);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [getIsFollowing, getRange, getView, intervalMs, setRange, setView]);

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      <h1 className="sm:hidden text-center">Solar Activity Timeline</h1>
      <div className="flex px-3">
        <div className="flex-grow basis-0 flex items-center gap-2">
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
            .filter(([_, viewSize]) => renderRange[1] - renderRange[0] > viewSize)
            .map(([label, viewSize]) => (
              <button
                key={label}
                type="button"
                className="btn-tiny"
                onClick={() => setFollowView(viewSize)}
              >
                {label}
              </button>
            ))}
          <button type="button" className="btn-tiny" onClick={() => setView(getRange())}>
            All
          </button>
        </div>
        <h1 className="mx-2 hidden sm:block">Solar Activity Timeline</h1>
        <div className="flex-grow basis-0 flex items-center flex-row-reverse">
          <button
            className={`btn-tiny ${renderIsFollowing ? 'btn-invert' : ''}`}
            type="button"
            onClick={() => {
              setIsFollowing(!getIsFollowing());
              if (getIsFollowing() && getView()[1] < getRange()[1]) panFollowView();
            }}
          >
            -&gt;
          </button>
        </div>
      </div>
      <div ref={parentRef} className="flex-grow px-1 md:px-3">
        <svg
          width={width}
          height={height}
          className="select-none touch-none overflow-visible absolute"
          onContextMenuCapture={(event) => event.preventDefault()}
        >
          <FluxMain
            width={width - mainLeftMargin - 56}
            height={height - brushHeight - 60}
            left={mainLeftMargin}
            view={renderView}
            minSizeMs={MIN_VIEW_SIZE_MS}
            setView={(setter) => setLimitedView(setter(getView()))}
            onTimeSelect={onTimeSelect}
          />
          <FluxBrush
            width={width}
            height={brushHeight}
            top={height - brushHeight}
            range={renderRange}
            view={renderView}
            minSizeMs={MIN_VIEW_SIZE_MS}
            onBrush={setLimitedView}
          />
        </svg>
      </div>
    </div>
  );
}
