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
  const showBrush = height > 300 && settings.showOverview;
  const brushHeight = height * 0.15;

  return (
    <svg width={width} height={height} className="overflow-visible absolute">
      <MainChart width={width} height={height - (showBrush ? brushHeight + THEME.spacePx(2) : 0)} />
      {showBrush && <BrushChart width={width} height={brushHeight} top={height - brushHeight} />}
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
          <div className={`flex flex-col content-center gap-3 overflow-y-hidden ${className}`}>
            <MaybeHelioView />
            <ChartHeader />
            <div
              ref={parentRef}
              className="flex-grow select-none touch-none"
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
