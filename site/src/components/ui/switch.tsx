'use client';

import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className = '', ...props }, ref) => (
  <SwitchPrimitives.Root
    className={
      `peer relative h-5 w-9 p-0 items-center rounded-full ` +
      `transition-colors data-[state=checked]:bg-text data-[state=unchecked]:bg-bg-1 ${className}`
    }
    // eslint-disable-next-line react/jsx-props-no-spreading
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={
        `absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-bg pointer-events-none ` +
        `transition-transform data-[state=checked]:translate-x data-[state=unchecked]:-translate-x-4`
      }
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
