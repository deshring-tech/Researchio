import type { Metadata, Viewport } from 'next';
import { Inter, Newsreader } from 'next/font/google';

import './globals.css';

/**
 * Fonts are self-hosted through `next/font`, which inlines the font-face
 * declarations and preloads the files. This removes the render-blocking request
 * to fonts.googleapis.com the stylesheet previously made, eliminates the
 * layout shift that came with it, and keeps the app working offline.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Researchio',
    template: '%s · Researchio',
  },
  description:
    'A research workspace where your notes and sources continuously build a cited, living document.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fcfcfc',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`}>
      <body>{children}</body>
    </html>
  );
}
