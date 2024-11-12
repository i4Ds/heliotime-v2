import {
  faAngleLeft,
  faAngleRight,
  faAnglesRight,
} from '@fortawesome/free-solid-svg-icons';
import { useWindowEvent } from '@/utils/window';
import { usePlayerRenderState, usePlayerState } from '../state/state';
import IconButton from './IconButton';
import { usePlayerSettings } from '../state/settings';
import ShareButton from './ShareButton';
import { usePanControl } from '../state/pan';
import SettingsButton from './SettingsButton';
import { ViewerButton } from './ViewerButton';

const CHART_TITLE = 'Solar Activity Timeline';

export default function ChartHeader() {
  const { range, view } = usePlayerRenderState();
  const state = usePlayerState();
  const [settings, changeSettings] = usePlayerSettings();

  const panControl = usePanControl();
  useWindowEvent('pointerup', () => panControl.stop());
  useWindowEvent('pointercancel', () => panControl.stop());

  return (
    <>
      <h1 className="sm:hidden text-center">{CHART_TITLE}</h1>
      <div className="flex overflow-x-auto gap-2">
        <div className="flex-grow basis-0 flex items-center gap-2">
          {(
            [
              [1 * 60 * 60 * 1000, '1H', 'last hour'],
              [24 * 60 * 60 * 1000, '1D', 'last day'],
              [7 * 24 * 60 * 60 * 1000, '1W', 'last week'],
              [30 * 24 * 60 * 60 * 1000, '1M', 'last month'],
              [365 * 24 * 60 * 60 * 1000, '1Y', 'last year'],
            ] as const
          )
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            .filter(([viewSize]) => range[1] - range[0] > viewSize)
            .map(([viewSize, label, tooltip]) => (
              <button
                key={label}
                type="button"
                className="btn-tiny"
                onClick={() => state.setFollowView(viewSize)}
                title={`View ${tooltip}`}
              >
                {label}
              </button>
            ))}
          <button
            type="button"
            className="btn-tiny"
            onClick={() => state.setView(range, true)}
            title="View everything"
          >
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
            className="hidden md:block btn-tiny"
            onPointerDown={() => panControl.start(true)}
            title="Pan right"
          />
          <IconButton
            icon={faAngleLeft}
            className="hidden md:block btn-tiny"
            onPointerDown={() => panControl.start(false)}
            title="Pan left"
          />
          <SettingsButton className="btn-tiny" />
          <ShareButton
            className="btn-tiny"
            data={() => ({ url: window.location.href, title: 'Heliotime' })}
            title="Share view"
          />
          <ViewerButton className={`${settings.showPreview ? 'hmd:hidden' : ''} btn-tiny`} />
        </div>
      </div>
    </>
  );
}
