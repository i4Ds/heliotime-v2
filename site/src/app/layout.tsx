import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';

const inter = Inter({ subsets: ['latin'] });

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
      <body className={`overflow-x-hidden ${inter.className}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
