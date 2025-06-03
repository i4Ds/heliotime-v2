import { faCog } from '@fortawesome/free-solid-svg-icons';
import { Suspense } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { THEME } from '@/app/theme';
import { useWindowSize } from '@/utils/window';
import { usePlayerSettings } from '../state/settings';
import IconButton from './IconButton';

interface SettingsButtonProps {
  className?: string;
}

export default function SettingsButton({ className = '' }: SettingsButtonProps) {
  const [settings, changeSettings] = usePlayerSettings();
  const windowSize = useWindowSize();
  const tooSmallForPreview = windowSize.height < THEME.screen.md;

  const button = <IconButton className={className} icon={faCog} title="Settings" />;
  return (
    <Suspense fallback={button}>
      <Popover>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        <PopoverContent side="top" className="w-auto !p-3 space-y-2">
          <div className="flex items-center space-x-2">
            <Switch
              id="lock-watt-axis"
              checked={settings.lockWattAxis}
              onCheckedChange={(value) => changeSettings({ lockWattAxis: value })}
            />
            <label htmlFor="lock-watt-axis">Lock watt axis</label>
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="show-preview"
              title={tooSmallForPreview ? 'Screen is too small' : ''}
              disabled={tooSmallForPreview}
              checked={!tooSmallForPreview && settings.showPreview}
              onCheckedChange={(value) => changeSettings({ showPreview: value })}
            />
            <label htmlFor="show-preview">Show sun preview</label>
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="show-overview"
              checked={settings.showOverview}
              onCheckedChange={(value) => changeSettings({ showOverview: value })}
            />
            <label htmlFor="show-overview">Show overview</label>
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="linear-overview"
              checked={settings.linearOverview}
              onCheckedChange={(value) => changeSettings({ linearOverview: value })}
            />
            <label htmlFor="linear-overview">Linear overview</label>
          </div>
        </PopoverContent>
      </Popover>
    </Suspense>
  );
}
