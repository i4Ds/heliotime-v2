import HelioPlayer from '@/components/player/HelioPlayer';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense>
      <HelioPlayer className="box-border min-h-0 w-dvw h-dvh p-3" />
    </Suspense>
  );
}
