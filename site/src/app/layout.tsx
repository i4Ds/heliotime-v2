import type { Metadata } from 'next';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import './globals.css';
import Providers from './providers';
import { THEME } from './theme';

config.autoAddCss = false;

export const metadata: Metadata = {
  title: 'Heliotime - Interactive Timeline for GOES X-Ray Data',
  description:
    'Heliotime.org offers you a new way to discover solar events and flares. View a timeline of all recorded X-Ray data from the GOES spacecrafts.',
  keywords: 'Solar, Events, GOES, X-Ray, Timeline, Flares, Flux, Helioviewer',
  robots: 'noimageindex',
  other: {
    // Prevent Dark Reader from inverting the page as it breaks the SVG diagrams.
    'darkreader-lock': '-',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`overflow-x-hidden ${THEME.font.className}`}>
        <NuqsAdapter>
          <Providers>{children}</Providers>
        </NuqsAdapter>
      </body>
    </html>
  );
}
