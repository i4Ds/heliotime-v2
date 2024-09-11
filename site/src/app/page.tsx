import HelioPlayer from '@/components/player/HelioPlayer';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense>
      <HelioPlayer className="w-dvw h-dvh p-3" />
    </Suspense>
  );
}
