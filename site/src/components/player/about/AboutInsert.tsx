import { usePathHash } from '@/utils/usePathHash';
import dynamic from 'next/dynamic';
import AboutContent from './about.md';

const AboutDialog = dynamic(() => import('./AboutDialog'), { ssr: false });

export default function AboutInsert() {
  const hash = usePathHash();
  const isOpen = hash === 'about';
  return (
    <>
      {!isOpen && <AboutContent className="hidden" />}
      <AboutDialog isOpen={isOpen} />
    </>
  );
}
