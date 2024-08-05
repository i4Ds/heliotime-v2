import type { Metadata } from 'next';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import './globals.css';
import Providers from './providers';
import { font } from './theme';

config.autoAddCss = false;

export const metadata: Metadata = {
  title: 'Heliotime - Interactive Timeline for GOES X-Ray Data',
  description:
    'Heliotime.org offers you a new way to discover solar events and flares. View a timeline of all recorded X-Ray data from the GOES spacecrafts.',
  keywords: 'Solar, Events, GOES, X-Ray, Timeline, Flares, Flux, Helioviewer',
  robots: 'noimageindex',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`overflow-x-hidden ${font.className}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
