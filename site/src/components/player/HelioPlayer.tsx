'use client';

import { useParentSize } from '@visx/responsive';
import HelioView from '@/components/player/view/HelioView';
import { THEME } from '@/app/theme';
import dynamic from 'next/dynamic';
import { HelioPlayerStateProvider } from './state/state';
import ChartHeader from './header/ChartHeader';
import { MainChart } from './chart/MainChart';
import BrushChart from './chart/BrushChart';
import { HelioPlayerSettingsProvider, usePlayerSettings } from './state/settings';
import { HelioPlayerPanProvider } from './state/pan';
import RepoLink from '../links/RepoLink';
import FhnwLink from '../links/FhnwLink';
import AboutLink from '../links/AboutLink';
import AboutInsert from './about/AboutInsert';

const ToasterWithWelcome = dynamic(() => import('./toast/ToasterWithWelcome'), { ssr: false });

function MaybeHelioView() {
  const [settings] = usePlayerSettings();
  if (!settings.showPreview) return undefined;
  return (
    <>
      <HelioView className="hidden hmd:flex h-[40dvh]" />
      <div className="absolute right-4 top-4 hidden sm:hmd:flex flex-row items-center text-3xl space-x-3">
        <FhnwLink />
        <RepoLink />
        <AboutLink />
      </div>
    </>
  );
}

function Chart({ width, height }: { width: number; height: number }) {
  const [settings] = usePlayerSettings();
  // iPhone chart panes are often ~250–320px; the old height>300 gate hid the overview.
  const brushGap = THEME.spacePx(2);
  const minMainHeight = 120;
  const minBrushHeight = 52;
  const maxBrushHeight = 88;
  const showBrush =
    settings.showOverview && height >= minMainHeight + minBrushHeight + brushGap;
  const brushHeight = showBrush
    ? Math.min(maxBrushHeight, Math.max(minBrushHeight, Math.round(height * 0.2)))
    : 0;
  const brushTop = height - brushHeight;

  return (
    <svg width={width} height={height} className="overflow-visible absolute inset-0">
      <MainChart width={width} height={height - (showBrush ? brushHeight + brushGap : 0)} />
      {showBrush && (
        // Prefer <g transform> over nested <svg y="..."> — more reliable on iOS Safari.
        <g transform={`translate(0, ${brushTop})`}>
          <BrushChart width={width} height={brushHeight} />
        </g>
      )}
    </svg>
  );
}

interface HelioPlayerProps {
  className?: string;
}

export default function HelioPlayer({ className = '' }: HelioPlayerProps) {
  const { parentRef, width, height } = useParentSize();
  return (
    <HelioPlayerSettingsProvider>
      <HelioPlayerStateProvider chartWidth={width}>
        <HelioPlayerPanProvider>
          <AboutInsert />
          {/* min-h-0: Safari flex children otherwise keep intrinsic min-height and the chart pane can stay at 0. */}
          <div className={`flex min-h-0 flex-col content-center gap-3 overflow-y-hidden ${className}`}>
            <MaybeHelioView />
            <ChartHeader />
            <div
              ref={parentRef}
              className="relative min-h-0 flex-1 basis-0 select-none touch-none"
              onContextMenuCapture={(event) => event.preventDefault()}
            >
              {width > 0 && height > 0 && <Chart width={width} height={height} />}
            </div>
          </div>
          <ToasterWithWelcome />
        </HelioPlayerPanProvider>
      </HelioPlayerStateProvider>
    </HelioPlayerSettingsProvider>
  );
}
