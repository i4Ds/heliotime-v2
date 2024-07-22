'use client';

import { useEffect, useState } from 'react';
import FluxChart from '@/chart/flux/FluxChart';
import HelioView from './HelioView';

export default function Home() {
  const [timestamp, setTimestamp] = useState<Date | undefined>();
  useEffect(() => setTimestamp(new Date()), []);

  return (
    <main className="h-screen flex flex-col content-center justify-around gap-2 py-3">
      <div className="hidden vsm:flex justify-between flex-col sm:flex-row gap-2 px-3">
        <h1 className="text-3xl sm:text-4xl my-auto text-center sm:text-left">
          <div>Solar Activity Timeline</div>
        </h1>
        {timestamp && <HelioView timestamp={timestamp} />}
      </div>
      <FluxChart className="flex-grow" onTimeSelect={setTimestamp} />
    </main>
  );
}
