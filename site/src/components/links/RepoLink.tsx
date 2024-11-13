import { faGithub } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';

interface RepoLinkProps {
  className?: string;
}

// eslint-disable-next-line prefer-arrow-callback
export default React.memo(function RepoLink({ className = '' }: RepoLinkProps) {
  return (
    <a
      href="https://github.com/i4Ds/heliotime-v2"
      target="_blank"
      rel="noopener"
      title="View source code on GitHub"
      aria-label="View source code on GitHub"
      className={className}
    >
      <FontAwesomeIcon icon={faGithub} />
    </a>
  );
});
