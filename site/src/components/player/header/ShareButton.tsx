import { faArrowUpFromBracket, faClipboardCheck } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';
import IconButton from './IconButton';

export interface ShareButtonProps {
  data: () => ShareData;
  className?: string;
  title: string;
}

export default function ShareButton({ data: getData, className, title }: ShareButtonProps) {
  const [icon, setIcon] = useState(faArrowUpFromBracket);

  const handleShare = async () => {
    const data = getData();
    try {
      await navigator.share(data);
    } catch {
      if (data.url === undefined) return;
      await navigator.clipboard.writeText(data.url);
      setIcon(faClipboardCheck);
      setTimeout(() => setIcon(faArrowUpFromBracket), 2000);
    }
  };

  return <IconButton className={className} icon={icon} onClick={handleShare} title={title} />;
}
