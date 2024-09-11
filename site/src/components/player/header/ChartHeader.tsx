import {
  faAngleLeft,
  faAngleRight,
  faAnglesRight,
  faArrowDownUpLock,
  faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';
import * as reactFontawesome from '@fortawesome/react-fontawesome';
import { getHelioviewerUrl } from '@/api/helioviewer';
import { useMemo } from 'react';
import { useWindowEvent } from '@/utils/useWindowEvent';
import { usePlayerRenderState, usePlayerState } from '../state/state';
import IconButton from './IconButton';
import { usePlayerSettings } from '../state/settings';
import ShareButton from './ShareButton';
import { usePanControl } from '../state/pan';

const CHART_TITLE = 'Solar Activity Timeline';

export default function ChartHeader() {
  const { range, view, timestamp } = usePlayerRenderState();
  const state = usePlayerState();
  const [settings, changeSettings] = usePlayerSettings();

  const panControl = usePanControl();
  useWindowEvent('pointerup', () => panControl.stop());
  useWindowEvent('pointercancel', () => panControl.stop());

  const viewerUrl = useMemo(() => getHelioviewerUrl(new Date(timestamp)), [timestamp]);
  return (
    <>
      <h1 className="sm:hidden text-center">{CHART_TITLE}</h1>
      <div className="flex overflow-x-auto gap-2">
        <div className="flex-grow basis-0 flex items-center gap-2">
          {(
            [
              ['1H', 1 * 60 * 60 * 1000],
              ['1D', 24 * 60 * 60 * 1000],
              ['1W', 7 * 24 * 60 * 60 * 1000],
              ['1M', 30 * 24 * 60 * 60 * 1000],
              ['1Y', 365 * 24 * 60 * 60 * 1000],
            ] as const
          )
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            .filter(([_, viewSize]) => range[1] - range[0] > viewSize)
            .map(([label, viewSize]) => (
              <button
                key={label}
                type="button"
                className="btn-tiny"
                onClick={() => state.setFollowView(viewSize)}
              >
                {label}
              </button>
            ))}
          <button type="button" className="btn-tiny" onClick={() => state.setView(range)}>
            All
          </button>
        </div>
        <h1 className="hidden sm:block overflow-x-auto text-nowrap select-text">{CHART_TITLE}</h1>
        <div className="flex-grow basis-0 flex items-center flex-row-reverse gap-2">
          <IconButton
            icon={faAnglesRight}
            className={`btn-tiny ${settings.isFollowing ? 'btn-invert' : ''}`}
            onClick={() => {
              const newIsFollowing = !settings.isFollowing;
              changeSettings({ isFollowing: newIsFollowing });
              if (newIsFollowing && view[1] < range[1]) state.setFollowView(view[1] - view[0]);
            }}
            title="Follow live"
          />
          <IconButton
            icon={faAngleRight}
            className="hidden xs:block hmd:block btn-tiny"
            onPointerDown={() => panControl.start(true)}
            title="Pan right"
          />
          <IconButton
            icon={faAngleLeft}
            className="hidden xs:block hmd:block btn-tiny"
            onPointerDown={() => panControl.start(false)}
            title="Pan left"
          />
          <IconButton
            icon={faArrowDownUpLock}
            square={false}
            className={`block btn-tiny ${settings.maximizeWattScale ? 'btn-invert' : ''}`}
            onClick={() => changeSettings({ maximizeWattScale: !settings.maximizeWattScale })}
            title="Lock watt axis"
          />
          <ShareButton
            className="btn-tiny"
            data={() => ({ url: window.location.href, title: 'Heliotime' })}
            title="Share view"
          />
          <a
            className="hmd:hidden btn btn-tiny btn-primary text-nowrap"
            href={viewerUrl}
            target="_blank"
            rel="noopener"
          >
            <span className="hidden md:inline">Helioviewer </span>
            <span className="md:hidden">HV </span>
            <reactFontawesome.FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </a>
        </div>
      </div>
    </>
  );
}
