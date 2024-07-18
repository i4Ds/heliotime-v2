'use client';

import { useEffect, useState } from 'react';
import FluxChart from '@/chart/flux/FluxChart';
import HelioView from './HelioView';

export default function Home() {
  const [timestamp, setTimestamp] = useState<Date | undefined>();
  useEffect(() => setTimestamp(new Date()), []);

  return (
    <main className="h-screen flex flex-col content-center justify-around gap-2 p-3 max-md:px-0">
      <div className="flex justify-between max-sm:flex-col gap-2 max-md:px-3">
        <h1 className="text-4xl mx-4 my-auto max-sm:text-3xl max-sm:text-center">
          <div>Solar Activity Timeline</div>
        </h1>
        {timestamp && <HelioView timestamp={timestamp} />}
      </div>
      <FluxChart className="flex-grow" onTimeSelect={setTimestamp} />
    </main>
  );
}
