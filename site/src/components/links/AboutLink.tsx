import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Link from 'next/link';
import React from 'react';

interface AboutLinkProps {
  className?: string;
}

// eslint-disable-next-line prefer-arrow-callback
export default React.memo(function AboutLink({ className = '' }: AboutLinkProps) {
  return (
    <Link
      href="#about"
      title="Open about page"
      aria-label="Open about page"
      className={`text-text-focus ${className}`}
    >
      <FontAwesomeIcon icon={faInfoCircle} />
    </Link>
  );
});
