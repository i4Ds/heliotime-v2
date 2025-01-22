import { faAngleLeft, faAngleRight, faAnglesRight } from '@fortawesome/free-solid-svg-icons';
import { useWindowEvent } from '@/utils/window';
import dynamic from 'next/dynamic';
import AboutLink from '@/components/links/AboutLink';
import { usePlayerState } from '../state/state';
import IconButton from './IconButton';
import { usePlayerSettings } from '../state/settings';
import { usePanControl } from '../state/pan';
import { ViewerButton } from './ViewerButton';
import { RangeButtons, RangeDropdown } from './range';

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
      <h1 className="block sm:hidden text-center">{CHART_TITLE}</h1>
      <div className="flex overflow-x-auto gap-2">
        <div className="hidden lg:flex hmd:hidden hmd:md:flex flex-grow basis-0 items-center gap-2">
          <RangeButtons buttonsClassName="btn-tiny" />
        </div>
        <div className="hidden sm:flex overflow-x-auto gap-2">
          <h1 className="text-nowrap select-text">{CHART_TITLE}</h1>
          <AboutLink className={`text-2xl ${settings.showPreview ? 'sm:hmd:hidden' : undefined}`} />
        </div>
        <div className="flex-grow basis-0 flex items-center justify-center sm:justify-end gap-2">
          <ViewerButton className={`${settings.showPreview ? 'hmd:hidden' : ''} btn-tiny`} />
          <AboutLink
            className="text-2xl block sm:hidden"
          />
          <DynamicShareButton
            className="btn-tiny"
            data={() => ({ url: globalThis.location.href, title: 'Heliotime' })}
            title="Share view"
          />
          <DynamicSettingsButton className="btn-tiny" />
          <RangeDropdown className="lg:hidden hmd:md:hidden btn-tiny" />
          <DynamicJumpButton className="btn-tiny" />
          <IconButton
            icon={faAngleLeft}
            className="hidden md:block xs:hmd:block btn-tiny"
            onPointerDown={() => panControl.start(false)}
            title="Pan left"
          />
          <IconButton
            icon={faAngleRight}
            className="hidden md:block xs:hmd:block btn-tiny"
            onPointerDown={() => panControl.start(true)}
            title="Pan right"
          />
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
        </div>
      </div>
    </>
  );
}
