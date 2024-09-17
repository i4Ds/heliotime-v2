import { getHelioviewerUrl, getSolarImageUrl } from '@/api/helioviewer';
import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { resFloor } from '@/utils/math';
import { usePlayerRenderState } from '../state/state';

const viewActionText = 'View on Helioviewer';

const doubleDigit = (value: number) => value.toString().padStart(2, '0');

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = doubleDigit(1 + date.getUTCMonth());
  const day = doubleDigit(date.getUTCDate());
  const hours = doubleDigit(date.getUTCHours());
  const minutes = doubleDigit(date.getUTCMinutes());
  const seconds = doubleDigit(date.getUTCSeconds());

  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds} UT`;
}

export interface HelioViewProps {
  className?: string;
}

export default function HelioView({ className = '' }: HelioViewProps) {
  const { timestamp } = usePlayerRenderState();
  // The SDO AIA images have a 12-second cadence. We floor to the nearest second.
  const flooredTimestamp = resFloor(timestamp, 1000);
  const date = useMemo(() => new Date(flooredTimestamp), [flooredTimestamp]);

  const viewerUrl = useMemo(() => getHelioviewerUrl(date), [date]);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => setIsLoading(true), [date]);
  return (
    <div className={`flex flex-col justify-center items-center gap-2 ${className}`}>
      <a
        href={viewerUrl}
        target="_blank"
        rel="noopener"
        title={viewActionText}
        className="relative flex-grow aspect-square overflow-hidden rounded-md border-2 border-bg-2"
      >
        <Image
          src="_" // Required but useless
          loader={({ width }) => getSolarImageUrl(date, width)}
          alt="Sun imaged by SDO"
          priority
          fill
          sizes="30dvh"
          // Will trigger immediately on Firefox after the load change.
          // See: https://github.com/vercel/next.js/issues/30128#issuecomment-1090283728
          onLoad={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
        />
        <div className="absolute w-full px-2 bottom-1 text-center text-xs text-text-dim">
          Imaged by SDO at {formatDate(date)}
        </div>
        {isLoading && (
          <div className="absolute size-full flex items-center justify-center backdrop-blur-sm bg-bg bg-opacity-20">
            Loading ...
          </div>
        )}
      </a>
      <a className="btn btn-primary" href={viewerUrl} target="_blank" rel="noopener">
        {viewActionText} <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="ml-0.5" />
      </a>
    </div>
  );
}
