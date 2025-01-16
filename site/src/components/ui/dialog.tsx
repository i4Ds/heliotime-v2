import * as DialogPrimitive from '@radix-ui/react-dialog';
import React, { useState } from 'react';
import { Portal } from '@radix-ui/react-portal';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

interface DialogCloseProps {
  float?: boolean;
}

const DialogClose = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close> & DialogCloseProps
>(({ float = true, className = '', ...props }, ref) => (
  <DialogPrimitive.Close
    ref={ref}
    className={(float ? 'absolute top-8 right-8 ' : '') + className}
    // eslint-disable-next-line react/jsx-props-no-spreading
    {...props}
  />
));
DialogClose.displayName = DialogPrimitive.Close.displayName;

function DialogOverlay() {
  return (
    <DialogPrimitive.Overlay
      className={
        'fixed inset-0 backdrop-brightness-50 z-10' +
        'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
        'data-[state=open]:fade-in data-[state=closed]:fade-out'
      }
    />
  );
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className = '', children, ...props }, ref) => {
  // eslint-disable-next-line unicorn/no-null
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <>
      {/* Workaround for broken exit animations when wrapping the dialog content.
          See: https://github.com/radix-ui/primitives/issues/3324 */}
      <Portal
        ref={setContainer}
        className="fixed inset-0 flex justify-center -z-10"
      />
      <DialogPrimitive.Portal container={container}>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          className={
            'z-20 bg-bg overflow-hidden md:rounded-md md:border border-bg-2 md:shadow-md ' +
            'w-full md:w-auto md:mx-8 md:my-2 md:hxs:my-8 md:hmd:my-16 ' +
            'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
            'data-[state=open]:fade-in data-[state=closed]:fade-out ' +
            `data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 ${className}`
          }
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...props}
        >
          {/* Inner div needed to have the scrollbar respect the rounded corners */}
          <div className="relative max-h-full overflow-y-auto py-8 px-8 xs:px-10">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose };
