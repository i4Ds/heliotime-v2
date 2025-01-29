'use client';

import { THEME } from '@/app/theme';
import { faClose } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const OFFSET = `${THEME.spacePx(4)}px`;

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      offset={OFFSET}
      mobileOffset={OFFSET}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
      style={{
        zIndex: 0, // Default is over the dialog.
        ...props.style,
      }}
      toastOptions={{
        classNames: {
          toast: 'rounded-md border border-bg-2 bg-bg p-4 shadow-md prose prose-sm',
          closeButton: 'rounded-full p-2.5',
          ...props.toastOptions?.classNames,
        },
        ...props.toastOptions,
      }}
      icons={{
        close: <FontAwesomeIcon icon={faClose} className="aspect-square m-0" />,
        ...props.icons,
      }}
    />
  );
}

export { Toaster };
