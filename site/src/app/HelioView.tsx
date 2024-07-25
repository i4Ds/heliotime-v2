import { getHelioviewerUrl, getSolarImageUrl } from '@/api/helioviewer';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';

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
  timestamp: Date;
  className?: string;
}

export default function HelioView({ timestamp, className = '' }: HelioViewProps) {
  const viewerUrl = useMemo(() => getHelioviewerUrl(timestamp), [timestamp]);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => setIsLoading(true), [timestamp]);
  return (
    <div className={`flex flex-col justify-center items-center gap-2 ${className}`}>
      <h1>Helioviewer Preview</h1>
      <a
        href={viewerUrl}
        target="_blank"
        rel="noopener"
        title={viewActionText}
        className="relative flex-grow aspect-square overflow-hidden rounded-md border-2 border-bg-2"
      >
        <Image
          src="_" // Required but useless
          loader={({ width }) => getSolarImageUrl(timestamp, width)}
          alt="Sun imaged by SDO"
          priority
          fill
          sizes='30dvh'
          onLoad={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
        />
        <div className="absolute w-full px-2 bottom-1 text-center text-xs text-text-dim">
          Imaged by SDO at {formatDate(timestamp)}
        </div>
        {isLoading && (
          <div className="absolute size-full flex items-center justify-center backdrop-blur-sm bg-bg bg-opacity-20">
            Loading ...
          </div>
        )}
      </a>
      <a className="btn btn-primary" href={viewerUrl} target="_blank" rel="noopener">
        {viewActionText}
      </a>
    </div>
  );
}
