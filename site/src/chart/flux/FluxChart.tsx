import { useCallback, useEffect, useMemo, useState } from 'react';
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
  faArrowDownUpLock,
  faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';
import { getHelioviewerUrl } from '@/api/helioviewer';
import { useWindowEvent } from '@/utils/useWindowEvent';
import { useInterval } from '@/utils/useInterval';
import { FluxMain } from './FluxMain';
import FluxBrush from './FluxBrush';
import { View } from './flux';

const CHART_TITLE = 'Solar Activity Timeline';
const FOLLOW_FRONTRUN_PERCENT = 0.1;
const MIN_VIEW_SIZE_MS = 5 * 60 * 1000;
const PAN_SPEED = 0.4;
const MIN_FRAME_INTERVAL = 1000 / 30;

export interface FluxChartProps {
  className?: string;
  selectedTime?: Date;
  onTimeSelect?: (timestamp: Date) => void;
}

export default function FluxChart({ className, selectedTime, onTimeSelect }: FluxChartProps) {
  const { parentRef, width, height } = useParentSize();
  const [lockWattAxis, setLockWattAxis] = useState(true);
  const mainLeftMargin = lockWattAxis ? 68 : 100;
  const brushHeight = height * 0.15;

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
      // Needs to be unlimited because the initial view is
      // set before the range is loaded.
      setUnlimitedView([frontrun - viewSize, frontrun]);
    },
    [setUnlimitedView]
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
  // Reduce refresh rate when zoomed out
  const liveRelevantView = getIsFollowing() ? renderView : renderRange;
  const liveIntervalsMs = Math.max(
    MIN_FRAME_INTERVAL,
    width === 0 ? 0 : (liveRelevantView[1] - liveRelevantView[0]) / width / 32
  );
  useInterval(liveIntervalsMs, (deltaMs) => {
    setRange([getRange()[0], Date.now()]);
    if (getIsFollowing()) setUnlimitedView(panView(getView(), deltaMs));
  });

  // Smooth panning logic
  const [, getPanSpeed, setPanSpeed] = useVolatileState(0);
  const setPanView = (relativeDelta: number) => {
    const view = getView();
    setView(panView(view, (view[1] - view[0]) * relativeDelta));
  };
  useInterval(
    MIN_FRAME_INTERVAL,
    getPanSpeed() === 0 ? undefined : (deltaMs) => setPanView((getPanSpeed() * deltaMs) / 1000)
  );
  useWindowEvent('keydown', (event) => {
    if (event.key === 'ArrowRight') setPanSpeed(PAN_SPEED);
    if (event.key === 'ArrowLeft') setPanSpeed(-PAN_SPEED);
  });
  useWindowEvent('keyup', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') setPanSpeed(0);
  });
  useWindowEvent('pointerup', () => setPanSpeed(0))
  useWindowEvent('pointercancel', () => setPanSpeed(0))

  const viewerUrl = useMemo(() => selectedTime && getHelioviewerUrl(selectedTime), [selectedTime]);
  return (
    <div
      className={`flex flex-col gap-3 select-none touch-none ${className ?? ''}`}
      onContextMenuCapture={(event) => event.preventDefault()}
    >
      <h1 className="sm:hidden text-center">{CHART_TITLE}</h1>
      <div className="flex mx-3 overflow-x-auto gap-2">
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
        <h1 className="hidden sm:block overflow-x-auto text-nowrap select-text">{CHART_TITLE}</h1>
        <div className="flex-grow basis-0 flex items-center flex-row-reverse gap-2">
          <button
            className={`btn-tiny ${renderIsFollowing ? 'btn-invert' : ''}`}
            type="button"
            onClick={() => {
              setIsFollowing(!getIsFollowing());
              if (getIsFollowing() && getView()[1] < getRange()[1]) {
                const view = getView();
                setFollowView(view[1] - view[0]);
              }
            }}
            aria-label="Follow live"
          >
            <FontAwesomeIcon icon={faAnglesRight} className="aspect-square" />
          </button>
          <button
            className="hidden xs:block hmd:block btn-tiny"
            type="button"
            onPointerDown={() => setPanSpeed(PAN_SPEED)}
            aria-label="Pan right"
          >
            <FontAwesomeIcon icon={faAngleRight} className="aspect-square" />
          </button>
          <button
            className="hidden xs:block hmd:block btn-tiny"
            type="button"
            onPointerDown={() => setPanSpeed(-PAN_SPEED)}
            aria-label="Pan left"
          >
            <FontAwesomeIcon icon={faAngleLeft} className="aspect-square" />
          </button>
          <button
            className={`block btn-tiny ${lockWattAxis ? 'btn-invert' : ''}`}
            type="button"
            onClick={() => setLockWattAxis(!lockWattAxis)}
            aria-label="Lock watt axis"
          >
            <FontAwesomeIcon icon={faArrowDownUpLock} />
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
          <svg width={width} height={height} className="overflow-visible absolute">
            <FluxMain
              width={width - mainLeftMargin - 55}
              height={height - brushHeight - 75}
              left={mainLeftMargin}
              view={renderView}
              minSizeMs={MIN_VIEW_SIZE_MS}
              lockWattAxis={lockWattAxis}
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
