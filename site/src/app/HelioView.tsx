import { getHelioviewerUrl, getSolarImageUrl } from '@/api/helioviewer';
import Image from 'next/image';
import { useMemo } from 'react';

const viewActionText = 'View on Helioviewer';

const doubleDigit = (value: number) => value.toString().padStart(2, '0');

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = doubleDigit(1 + date.getUTCMonth());
  const day = doubleDigit(date.getUTCDate());
  const hours = doubleDigit(date.getUTCHours());
  const minutes = doubleDigit(date.getUTCMinutes());
  const seconds = doubleDigit(date.getUTCSeconds());

  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds} UTC`;
}

export interface HelioViewProps {
  timestamp: Date;
}

export default function HelioView({ timestamp }: HelioViewProps) {
  const viewerUrl = useMemo(() => getHelioviewerUrl(timestamp), [timestamp]);
  return (
    <div className="flex justify-center items-center gap-3">
      <div className="flex flex-col gap-2">
        <div>{formatDate(timestamp)}</div>
        <a
          className="btn btn-primary"
          href={viewerUrl}
          target="_blank"
          rel="noopener"
        >
          {viewActionText}
        </a>
      </div>
      <a href={viewerUrl} target="_blank" rel="noopener" title={viewActionText}>
        <Image
          className="max-w-32 rounded-md"
          src={getSolarImageUrl(timestamp)}
          alt={`The sun at ${timestamp}`}
          width={500}
          height={500}
          priority
        />
      </a>
    </div>
  );
}
