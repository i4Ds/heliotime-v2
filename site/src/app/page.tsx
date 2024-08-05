'use client';

import { useEffect, useState } from 'react';
import FluxChart from '@/chart/flux/FluxChart';
import HelioView from './HelioView';

export default function Home() {
  const [timestamp, setTimestamp] = useState<Date | undefined>();
  useEffect(() => setTimestamp(new Date()), []);

  return (
    <main className="flex flex-col content-center justify-around gap-4 pt-2 pb-1 hxs:pb-3">
      {/* TODO: Show button in FluxChart when HelioView is hidden */}
      {timestamp && <HelioView timestamp={timestamp} className='hidden hmd:flex h-[40dvh]'/>}
      <FluxChart className="flex-grow" selectedTime={timestamp} onTimeSelect={setTimestamp} />
    </main>
  );
}
