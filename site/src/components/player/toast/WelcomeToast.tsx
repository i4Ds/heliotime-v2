import Link from 'next/link';
import React from 'react';
import { useEffect } from 'react';
import { toast } from 'sonner';

const VISITED_KEY = 'visited';

function WelcomeMessage(id: number | string = '') {
  return (
    <div className="prose prose-sm">
      Welcome to Heliotime! A solar activity browser.
      <br />
      Check out the{' '}
      <Link href="#about" onClick={() => toast.dismiss(id)}>
        about page
      </Link>{' '}
      for details.
    </div>
  );
}

function WelcomeToast() {
  useEffect(() => {
    if (localStorage.getItem(VISITED_KEY)) return;
    localStorage.setItem(VISITED_KEY, 'true');
    // Required to work on page load
    setTimeout(() => {
      toast(WelcomeMessage, {
        duration: Number.POSITIVE_INFINITY,
      });
    });
  }, []);
  return undefined;
}

const MemoWelcomeToast = React.memo(WelcomeToast);

export default MemoWelcomeToast;
