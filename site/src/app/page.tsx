'use client';

import { useEffect, useState } from 'react';
import { FluxChart } from './FluxChart';
import HelioView from './HelioView';

export default function Home() {
  const [timestamp, setTimestamp] = useState<Date | undefined>();
  useEffect(() => setTimestamp(new Date()), []);

  return (
    <main className="min-h-screen flex flex-col content-center justify-around gap-4">
      {timestamp && <HelioView timestamp={timestamp} />}
      <FluxChart onTimeSelect={setTimestamp} />
    </main>
  );
}
