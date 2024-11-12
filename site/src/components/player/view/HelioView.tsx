import { HelioviewerSource } from '@/api/helioviewer';
import { faArrowUpRightFromSquare, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Image, { ImageLoader } from 'next/image';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  const { view, timestamp } = usePlayerRenderState();
  const source = useMemo(() => HelioviewerSource.select(timestamp), [timestamp]);
  // Prefer the unrounded timestamp for the viewer URL.
  // In very very rare cases, that might load a slightly different image.
  const viewerUrl = useMemo(() => source.getViewerUrl(new Date(timestamp)), [source, timestamp]);

  // Get image infos. Round timestamp to improve cache hits.
  const roundedTimestamp = source.roundTimestamp(timestamp);
  const getClosestImageUrl: ImageLoader = useCallback(
    ({ width }) => source.getClosestImageUrl(new Date(roundedTimestamp), width),
    [roundedTimestamp, source]
  );
  const closestImageTimestamp = useQuery({
    queryKey: [source, roundedTimestamp],
    queryFn: () => source.fetchClosestImageTimestamp(new Date(roundedTimestamp)),
  }).data;

  // Check if loaded image is close enough to the selected timestamp.
  const isCloseEnough = useMemo(() => {
    if (closestImageTimestamp === undefined) return false;
    const acceptableDeltaMs = (view[1] - view[0]) / 100;
    return Math.abs(closestImageTimestamp.getTime() - timestamp) < acceptableDeltaMs;
  }, [closestImageTimestamp, timestamp, view]);

  // Once the loader changes, the image is loading.
  const [lastImageLoader, setLastImageLoader] = useState<ImageLoader | undefined>(undefined);
  const isLoading = getClosestImageUrl !== lastImageLoader;
  const markLoaded = useCallback(
    () => setLastImageLoader(() => getClosestImageUrl),
    [getClosestImageUrl]
  );

  // Keep the last load state while loading.
  const lastLoadState = useRef({ name: source.name, closestImageTimestamp, isCloseEnough });
  if (!isLoading)
    lastLoadState.current = { name: source.name, closestImageTimestamp, isCloseEnough };
  const state = lastLoadState.current;

  return (
    <div className={`flex flex-col justify-center items-center gap-2 ${className}`}>
      <a
        href={viewerUrl}
        target="_blank"
        rel="noopener"
        title={viewActionText}
        className="relative flex-grow aspect-square overflow-hidden rounded-md border border-bg-2"
      >
        <Image
          src="_" // Required but useless
          loader={getClosestImageUrl}
          alt={`Sun imaged by ${state.name}`}
          priority
          fill
          sizes="30dvh"
          // Will trigger immediately on Firefox after the load change.
          // See: https://github.com/vercel/next.js/issues/30128#issuecomment-1090283728
          onLoad={markLoaded}
          onError={markLoaded}
        />
        <div
          className="absolute w-full px-2 bottom-1 text-center text-xs text-text-dim whitespace-nowrap"
          style={{ textShadow: '0 0 5px black, 0 0 5px black' }}
        >
          {`Imaged by ${state.name} at `}
          <wbr />
          {`${state.closestImageTimestamp === undefined ? 'unknown' : formatDate(state.closestImageTimestamp)} `}
          {!state.isCloseEnough && (
            <span
              // Cannot pass title directly to icon because it will cause SSR mismatches.
              // See: https://github.com/FortAwesome/react-fontawesome/issues/550
              title={
                state.closestImageTimestamp === undefined
                  ? 'Capture time is unknown'
                  : 'Capture time is far from selected time'
              }
            >
              <FontAwesomeIcon icon={faTriangleExclamation} className="text-warn" />
            </span>
          )}
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
