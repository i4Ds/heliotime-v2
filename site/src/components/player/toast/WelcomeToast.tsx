import Link from 'next/link';
import React from 'react';
import { useEffect } from 'react';
import { toast } from 'sonner';

const VISITED_KEY = 'visited';

/**
 * Workaround to access the toast ID inside the toast itself.
 * {@link toast.custom} does the same but removes the close button.
 */
interface Ref {
  id?: number | string;
}

function WelcomeMessage(ref: Ref) {
  return (
    <div className="prose prose-sm">
      Welcome to Heliotime! A solar activity browser.
      <br />
      Check out the{' '}
      <Link
        href="#about"
        // eslint-disable-next-line react/destructuring-assignment
        onClick={() => toast.dismiss(ref.id!)}
      >
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
      const ref: Ref = {};
      ref.id = toast(WelcomeMessage(ref), {
        duration: Number.POSITIVE_INFINITY,
      });
    });
  }, []);
  return undefined;
}

const MemoWelcomeToast = React.memo(WelcomeToast);

export default MemoWelcomeToast;
