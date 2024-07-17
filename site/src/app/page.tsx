'use client';

import { useEffect, useState } from 'react';
import FluxChart from '@/chart/flux/FluxChart';
import HelioView from './HelioView';

export default function Home() {
  const [timestamp, setTimestamp] = useState<Date | undefined>();
  useEffect(() => setTimestamp(new Date()), []);

  return (
    <main className="h-screen flex flex-col content-center justify-around gap-4 p-2">
      <div className="flex justify-between">
        <h1 className="text-4xl mx-4 my-auto">Heliotime - Solar Activity Viewer</h1>
        {timestamp && <HelioView timestamp={timestamp} />}
      </div>
      <FluxChart className="flex-grow" onTimeSelect={setTimestamp} />
    </main>
  );
}
