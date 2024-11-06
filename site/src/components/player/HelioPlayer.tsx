'use client';

import { useParentSize } from '@visx/responsive';
import HelioView from '@/components/player/view/HelioView';
import { THEME } from '@/app/theme';
import { HelioPlayerStateProvider } from './state/state';
import ChartHeader from './header/ChartHeader';
import { MainChart } from './chart/MainChart';
import BrushChart from './chart/BrushChart';
import { HelioPlayerSettingsProvider } from './state/settings';
import { HelioPlayerPanProvider } from './state/pan';

interface HelioPlayerProps {
  className?: string;
}

export default function HelioPlayer({ className = '' }: HelioPlayerProps) {
  const { parentRef, width, height } = useParentSize();
  const showBrush = height > 300;
  const brushHeight = height * 0.15;

  return (
    <HelioPlayerSettingsProvider>
      <HelioPlayerStateProvider chartWidth={width}>
        <HelioPlayerPanProvider>
          <div className={`flex flex-col content-center gap-3 overflow-y-hidden ${className}`}>
            <HelioView className="hidden hmd:flex h-[40dvh]" />
            <ChartHeader />
            <div
              ref={parentRef}
              className="flex-grow select-none touch-none"
              onContextMenuCapture={(event) => event.preventDefault()}
            >
              {width > 0 && height > 0 && (
                <svg width={width} height={height} className="overflow-visible absolute">
                  <MainChart
                    width={width}
                    height={height - (showBrush ? brushHeight + THEME.spacePx(2) : 0)}
                  />
                  {showBrush && (
                    <BrushChart width={width} height={brushHeight} top={height - brushHeight} />
                  )}
                </svg>
              )}
            </div>
          </div>
        </HelioPlayerPanProvider>
      </HelioPlayerStateProvider>
    </HelioPlayerSettingsProvider>
  );
}
