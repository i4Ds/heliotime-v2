import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { ButtonHTMLAttributes, DetailedHTMLProps } from 'react';

interface IconButtonProps
  extends DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> {
  icon: IconDefinition;
  /**
   * Will also set the `aria-label` attribute.
   */
  title: string;
  square?: boolean;
}

export default function IconButton({ icon, title, square = true, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...rest}
    >
      <FontAwesomeIcon icon={icon} className={square ? 'aspect-square' : undefined} />
    </button>
  );
}
