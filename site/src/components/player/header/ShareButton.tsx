import { faArrowUpFromBracket } from '@fortawesome/free-solid-svg-icons';
import { Suspense, useCallback, useRef, useState } from 'react';
import React from 'react';
import IconButton from './IconButton';

const lazyPopover = (component: keyof typeof import('@/components/ui/popover')) =>
  React.lazy(() => import('@/components/ui/popover').then((mod) => ({ default: mod[component] })));
const Popover = lazyPopover('Popover');
const PopoverAnchor = lazyPopover('PopoverAnchor');
const PopoverContent = lazyPopover('PopoverContent');

export interface ShareButtonProps {
  data: () => ShareData;
  className?: string;
  title: string;
}

export default function ShareButton({ data: getData, className, title }: ShareButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [copyUrl, setCopyUrl] = useState<string>();

  const handleShare = async () => {
    if (copyUrl !== undefined) return;
    const data = getData();
    try {
      await navigator.share(data);
    } catch {
      if (data.url === undefined) return;
      try {
        await navigator.clipboard.writeText(data.url);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 3000);
      } catch {
        setCopyUrl(data.url);
      }
    }
  };

  const onOpenChange = useCallback((open: boolean) => {
    if (open) return;
    setCopyUrl(undefined);
    setIsCopied(false);
  }, []);
  const selectAll = useCallback(() => inputRef.current?.select(), []);
  const button = (
    <IconButton
      className={className}
      icon={faArrowUpFromBracket}
      title={title}
      onClick={handleShare}
    />
  );
  return (
    <Suspense fallback={button}>
      <Popover open={isCopied} onOpenChange={onOpenChange}>
        <PopoverAnchor>
          <Popover open={copyUrl !== undefined} onOpenChange={onOpenChange}>
            <PopoverAnchor>{button}</PopoverAnchor>
            <PopoverContent side="top" className="w-auto !p-2">
              <input
                ref={inputRef}
                value={copyUrl}
                readOnly
                onFocus={selectAll}
                onClick={selectAll}
              />
            </PopoverContent>
          </Popover>
        </PopoverAnchor>
        <PopoverContent side="top" className="w-auto px-3 py-1.5">
          Copied link!
        </PopoverContent>
      </Popover>
    </Suspense>
  );
}
