import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useMemo } from 'react';
import { HelioviewerSource } from '@/api/helioviewer';
import React from 'react';
import { usePlayerRenderState } from '../state/state';

interface ViewerButtonProps {
  className?: string;
}

function InternalViewerButton({
  className = '',
  timestamp,
}: ViewerButtonProps & { timestamp: number }) {
  const source = useMemo(() => HelioviewerSource.select(timestamp), [timestamp]);
  const viewerUrl = useMemo(() => source.getViewerUrl(new Date(timestamp)), [source, timestamp]);
  return (
    <a
      className={`btn btn-primary text-nowrap ${className}`}
      href={viewerUrl}
      target="_blank"
      rel="noopener"
      title="View on Helioviewer"
    >
      <span className="hidden lg:inline">Helioviewer </span>
      <span className="lg:hidden">HV </span>
      <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
    </a>
  );
}

const MemoViewerButton = React.memo(InternalViewerButton);

export function ViewerButton(props: ViewerButtonProps) {
  const { timestamp } = usePlayerRenderState();
  // eslint-disable-next-line react/jsx-props-no-spreading
  return <MemoViewerButton {...props} timestamp={timestamp} />;
}
