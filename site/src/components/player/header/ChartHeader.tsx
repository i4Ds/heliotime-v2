import { faAngleLeft, faAngleRight, faAnglesRight } from '@fortawesome/free-solid-svg-icons';
import { useWindowEvent } from '@/utils/window';
import RepoLink from '@/components/links/RepoLink';
import FhnwLink from '@/components/links/FhnwLink';
import dynamic from 'next/dynamic';
import AboutLink from '@/components/links/AboutLink';
import { usePlayerState } from '../state/state';
import IconButton from './IconButton';
import { usePlayerSettings } from '../state/settings';
import { usePanControl } from '../state/pan';
import { ViewerButton } from './ViewerButton';
import { RangeButtons } from './RangeButtons';

const DynamicJumpButton = dynamic(() => import('./JumpButton'), { ssr: false });
const DynamicSettingsButton = dynamic(() => import('./SettingsButton'), { ssr: false });
const DynamicShareButton = dynamic(() => import('./ShareButton'), { ssr: false });

const CHART_TITLE = 'Solar Activity Timeline';

export default function ChartHeader() {
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
          <RangeButtons />
          <RepoLink className={`text-2xl ${settings.showPreview ? 'sm:hmd:hidden' : undefined}`} />
          <FhnwLink className={`text-2xl ${settings.showPreview ? 'sm:hmd:hidden' : undefined}`} />
          <AboutLink className={`text-2xl ${settings.showPreview ? 'sm:hmd:hidden' : undefined}`} />
        </div>
        <h1 className="hidden sm:block overflow-x-auto text-nowrap select-text">{CHART_TITLE}</h1>
        <div className="flex-grow basis-0 flex items-center flex-row-reverse gap-2">
          <IconButton
            icon={faAnglesRight}
            className={`btn-tiny ${settings.isFollowing ? 'btn-invert' : ''}`}
            onClick={() => {
              const newIsFollowing = !settings.isFollowing;
              changeSettings({ isFollowing: newIsFollowing });
              const view = state.view();
              if (newIsFollowing && view[1] < state.range()[1])
                state.setFollowView(view[1] - view[0]);
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
          <DynamicJumpButton className="btn-tiny" />
          <DynamicSettingsButton className="btn-tiny" />
          <DynamicShareButton
            className="btn-tiny"
            data={() => ({ url: globalThis.location.href, title: 'Heliotime' })}
            title="Share view"
          />
          <ViewerButton className={`${settings.showPreview ? 'hmd:hidden' : ''} btn-tiny`} />
        </div>
      </div>
    </>
  );
}
