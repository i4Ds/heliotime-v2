import FluxBrush, { FluxBrushRef } from '@/chart/FluxBrush';
import { FluxMain } from '@/chart/FluxMain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { View } from './flux';

const FOLLOW_LIVE_INTERVAL = 200;

export interface FluxChartProps {
  className?: string;
  onTimeSelect?: (timestamp: Date) => void;
}

export default function FluxChart({ className, onTimeSelect }: FluxChartProps) {
  const brushRef = useRef<FluxBrushRef>(null);
  const viewState = useState<View>();
  const [view, setRawView] = viewState;

  // TODO: clean up brush state management and its problem
  // updateBrush flag is needed to prevent recursive updates from the brush
  const updateBrush = useRef<boolean>(false);
  useEffect(() => {
    if (!updateBrush.current) return;
    brushRef.current?.updateBrush(view);
    updateBrush.current = false;
  }, [view]);

  const setView = useCallback(
    (...args: Parameters<typeof setRawView>) => {
      updateBrush.current = true;
      setRawView(...args);
    },
    [setRawView]
  );
  const setFollowView = useCallback(
    (viewSize: number) => {
      const now = Date.now();
      setView([now - viewSize, now]);
    },
    [setView]
  );
  const panFollowView = useCallback(() => {
    if (view === undefined) return;
    setFollowView(view[1] - view[0]);
  }, [setFollowView, view]);

  // Follow live time
  const pauseFollow = useRef(false);
  const shouldFollow = view !== undefined && view[1] > Date.now() - FOLLOW_LIVE_INTERVAL * 2;
  useEffect(() => {
    if (!shouldFollow) return undefined;
    const interval = setInterval(() => {
      if (pauseFollow.current) return;
      panFollowView();
    }, FOLLOW_LIVE_INTERVAL);
    return () => clearInterval(interval);
  }, [panFollowView, pauseFollow, shouldFollow, view]);

  return (
    <div className={`overflow-hidden flex flex-col ${className ?? ''} `}>
      <div className="flex p-2 gap-2">
        {/* TODO: refactor to button tailwind class */}
        {/* TODO: do not show intervals which are too big */}
        <button
          className="px-2 py-1 rounded-md bg-blue-300"
          type="button"
          onClick={() => setFollowView(60 * 60 * 1000)}
        >
          1H
        </button>
        <button
          className="px-2 py-1 rounded-md bg-blue-300"
          type="button"
          onClick={() => setFollowView(24 * 60 * 60 * 1000)}
        >
          1D
        </button>
        <button
          className="px-2 py-1 rounded-md bg-blue-300"
          type="button"
          onClick={() => setFollowView(7 * 24 * 60 * 60 * 1000)}
        >
          1W
        </button>
        <button
          className="px-2 py-1 rounded-md bg-blue-300"
          type="button"
          onClick={() => setFollowView(30 * 24 * 60 * 60 * 1000)}
        >
          1M
        </button>
        <button
          className="px-2 py-1 rounded-md bg-blue-300"
          type="button"
          onClick={() => setFollowView(365 * 24 * 60 * 60 * 1000)}
        >
          1Y
        </button>
        <button
          className="px-2 py-1 rounded-md bg-blue-300"
          type="button"
          onClick={() => setView(undefined)}
        >
          All
        </button>
        <button
          className={`px-2 py-1 rounded-md ml-auto ${shouldFollow ? 'bg-blue-400' : 'bg-blue-300'}`}
          type="button"
          onClick={() => panFollowView()}
        >
          -&gt;
        </button>
      </div>
      <div className="overflow-hidden flex-grow">
        <ParentSize>
          {({ width, height }) => {
            const brushHeight = height * 0.15;
            const marginLeft = 70;
            return (
              <svg width={width} height={height} className="overflow-visible">
                <FluxMain
                  width={width - marginLeft}
                  height={height - brushHeight - 40}
                  left={marginLeft}
                  view={view}
                  setView={(setter) =>
                    setView((previous) =>
                      // Cannot call updateBrush here because setters need to be pure
                      brushRef.current?.clampView(setter(previous))
                    )
                  }
                  onTimeSelect={onTimeSelect}
                />
                <FluxBrush
                  ref={brushRef}
                  width={width - marginLeft}
                  height={brushHeight}
                  top={height - brushHeight}
                  left={marginLeft}
                  onBrush={(range) => setRawView(range)}
                  onBrushStart={() => {
                    pauseFollow.current = true;
                  }}
                  onBrushEnd={() => {
                    pauseFollow.current = false;
                  }}
                />
              </svg>
            );
          }}
        </ParentSize>
      </div>
    </div>
  );
}
