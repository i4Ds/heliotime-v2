import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { DialogTitle } from '@radix-ui/react-dialog';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClose } from '@fortawesome/free-solid-svg-icons';
import type { MDXComponents } from 'mdx/types';
import { useRouter } from 'next/navigation';
import AboutContent from './about.md';

const ABOUT_COMPONENTS = {
  h1({ className = '', ...props }) {
    return (
      <DialogTitle asChild>
        {/* Add padding to avoid floating close button */}
        {/* eslint-disable-next-line jsx-a11y/heading-has-content, react/jsx-props-no-spreading */}
        <h1 className={`pr-10 ${className}`} {...props} />
      </DialogTitle>
    );
  },
} satisfies MDXComponents;

export interface AboutDialogProps {
  isOpen: boolean;
}

export default function AboutDialog({ isOpen }: AboutDialogProps) {
  const router = useRouter();
  return (
    <Dialog open={isOpen} onOpenChange={(open) => router.push(open ? '#about' : '#')}>
      <DialogContent aria-describedby={undefined}>
        <DialogClose asChild float>
          {/* href must be # to keep the query parameters. */}
          {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
          <Link href="#" className="btn-text leading-none rounded-full p-1">
            <FontAwesomeIcon icon={faClose} className="aspect-square text-3xl" />
          </Link>
        </DialogClose>
        <AboutContent components={ABOUT_COMPONENTS} />
      </DialogContent>
    </Dialog>
  );
}
