'use client';

import { THEME } from '@/app/theme';
import { Toaster } from '@/components/ui/sonner';
import { useScreenSize } from '@visx/responsive';
import React from 'react';
import WelcomeToast from './WelcomeToast';
import { usePlayerSettings } from '../state/settings';

interface InnerToasterProps {
  positionLeft: boolean;
  expand: boolean;
  closeButton: boolean;
}

function InnerToaster({ positionLeft, expand, closeButton }: InnerToasterProps) {
  return (
    <Toaster
      swipeDirections={['left', 'top']}
      position={positionLeft ? 'top-left' : 'top-center'}
      expand={expand}
      toastOptions={{ closeButton }}
    />
  );
}

const MemoToaster = React.memo(InnerToaster);

export default function ToasterWithWelcome() {
  const [settings] = usePlayerSettings();
  const { width, height } = useScreenSize({
    initialSize: window.screen,
  });
  const positionLeft = width >= THEME.screen.lg;
  const positionOverNothing = positionLeft && settings.showPreview && height >= THEME.screen.md;
  // Sonner has a hardcoded 600px breakpoint.
  // See: https://github.com/emilkowalski/sonner/issues/376
  const desktopScreen = width > 600;
  return (
    <>
      {/* Needs to be in same load chunk as toaster,
          to ensure the welcome toast actually gets displayed. */}
      <WelcomeToast />
      <MemoToaster
        positionLeft={positionLeft && desktopScreen}
        expand={positionOverNothing}
        closeButton={desktopScreen}
      />
    </>
  );
}
