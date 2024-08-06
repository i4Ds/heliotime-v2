import { useCallback, useEffect, useMemo } from 'react';
import { useParentSize } from '@visx/responsive';
import { useQuery } from '@tanstack/react-query';
import { useFluxRangeQuery } from '@/api/flux';
import { NumberRange } from '@/utils/range';
import { limitView, panView } from '@/utils/panZoom';
import { useVolatileState } from '@/utils/useVolatile';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faAngleLeft,
  faAngleRight,
  faAnglesRight,
  faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';
import { getHelioviewerUrl } from '@/api/helioviewer';
import { FluxMain } from './FluxMain';
import FluxBrush from './FluxBrush';
import { View } from './flux';

const FOLLOW_FRONTRUN_PERCENT = 0.1;
const MIN_VIEW_SIZE_MS = 5 * 60 * 1000;
const PAN_BUTTON_JUMP = 0.1;

export interface FluxChartProps {
  className?: string;
  selectedTime?: Date;
  onTimeSelect?: (timestamp: Date) => void;
}

export default function FluxChart({ className, selectedTime, onTimeSelect }: FluxChartProps) {
  const { parentRef, width, height } = useParentSize();
  const brushHeight = height * 0.15;
  const mainLeftMargin = 100;

  const [renderRange, getRange, setRange] = useVolatileState<NumberRange>([0, 0]);
  const [renderView, getView, setRawView] = useVolatileState<View>(renderRange);
  const [renderIsFollowing, getIsFollowing, setIsFollowing] = useVolatileState(true);
  const setUnlimitedView = useCallback(
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
  const setView = useCallback(
    (newView: View) => {
      const range = getRange();
      const overflow = Math.min(newView[1] - newView[0], range[1] - range[0]) * 0.9;
      setUnlimitedView(
        limitView(newView, [range[0] - overflow, range[1] + overflow], MIN_VIEW_SIZE_MS)
      );
    },
    [getRange, setUnlimitedView]
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

  const setPanView = useCallback(
    (relativeDelta: number) => {
      const view = getView();
      setView(panView(view, (view[1] - view[0]) * relativeDelta));
    },
    [getView, setView]
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
    setView(getView());
  }, [dataRange, getRange, getView, setView, setRange]);

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
      setRange([range[0], newEnd]);
      if (getIsFollowing()) setUnlimitedView(panView(getView(), newEnd - range[1]));
    }, intervalMs);
    return () => clearInterval(interval);
  }, [getIsFollowing, getRange, getView, intervalMs, setRange, setUnlimitedView]);

  const viewerUrl = useMemo(() => selectedTime && getHelioviewerUrl(selectedTime), [selectedTime]);
  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      <h1 className="sm:hidden text-center">Solar Activity Timeline</h1>
      <div className="flex px-3 overflow-hidden">
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
          <button type="button" className="btn-tiny" onClick={() => setUnlimitedView(getRange())}>
            All
          </button>
        </div>
        <h1 className="mx-2 hidden sm:block truncate">Solar Activity Timeline</h1>
        <div className="flex-grow basis-0 flex items-center flex-row-reverse gap-2">
          <button
            className={`btn-tiny ${renderIsFollowing ? 'btn-invert' : ''}`}
            type="button"
            onClick={() => {
              setIsFollowing(!getIsFollowing());
              if (getIsFollowing() && getView()[1] < getRange()[1]) panFollowView();
            }}
            aria-label="Follow live"
          >
            <FontAwesomeIcon icon={faAnglesRight} className="aspect-square" />
          </button>
          <button
            className="hidden xs:block hmd:block btn-tiny"
            type="button"
            onClick={() => setPanView(PAN_BUTTON_JUMP)}
            aria-label="Pan right"
          >
            <FontAwesomeIcon icon={faAngleRight} className="aspect-square" />
          </button>
          <button
            className="hidden xs:block hmd:block btn-tiny "
            type="button"
            onClick={() => setPanView(-PAN_BUTTON_JUMP)}
            aria-label="Pan left"
          >
            <FontAwesomeIcon icon={faAngleLeft} className="aspect-square" />
          </button>
          {viewerUrl && (
            <a
              className="hmd:hidden btn btn-tiny btn-primary text-nowrap"
              href={viewerUrl}
              target="_blank"
              rel="noopener"
            >
              <span className="hidden md:inline">Helioviewer </span>
              <span className="md:hidden">HV </span>
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            </a>
          )}
        </div>
      </div>
      <div ref={parentRef} className="flex-grow px-1 md:px-3">
        {width && height && (
          <svg
            width={width}
            height={height}
            className="select-none touch-none overflow-visible absolute"
            onContextMenuCapture={(event) => event.preventDefault()}
          >
            <FluxMain
              width={width - mainLeftMargin - 55}
              height={height - brushHeight - 75}
              left={mainLeftMargin}
              view={renderView}
              minSizeMs={MIN_VIEW_SIZE_MS}
              setView={(setter) => setView(setter(getView()))}
              onTimeSelect={onTimeSelect}
            />
            <FluxBrush
              width={width}
              height={brushHeight}
              top={height - brushHeight}
              range={renderRange}
              view={renderView}
              minSizeMs={MIN_VIEW_SIZE_MS}
              onBrush={setView}
            />
          </svg>
        )}
      </div>
    </div>
  );
}
