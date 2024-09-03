'use client';

import { useEffect } from 'react';
import FluxChart from '@/chart/flux/FluxChart';
import { parseAsIsoDateTime, useQueryState } from 'nuqs';
import HelioView from './HelioView';

export const dynamic = 'force-static';

export default function Home() {
  const [timestamp, setTimestamp] = useQueryState('date', parseAsIsoDateTime);
  useEffect(() => {
    if (timestamp !== null) return;
    setTimestamp(new Date());
  }, [setTimestamp, timestamp]);

  return (
    <main className="flex flex-col content-center justify-around gap-4 pt-2 pb-1 hxs:pb-3">
      {timestamp && <HelioView timestamp={timestamp} className="hidden hmd:flex h-[40dvh]" />}
      <FluxChart
        className="flex-grow"
        selectedTime={timestamp ?? undefined}
        onTimeSelect={setTimestamp}
      />
    </main>
  );
}
