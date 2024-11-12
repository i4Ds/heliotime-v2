import { Inter } from 'next/font/google';

// Must be a top-level const for Next.js
const font = Inter({ subsets: ['latin'] });

// Should replicate config at ../../tailwind.config.js
export const THEME = {
  remPx: 16,
  font,
  colors: {
    bg: {
      DEFAULT: 'hsl(0 0% 0%)',
      0: 'hsl(0 0% 8%)',
      1: 'hsl(0 0% 16%)',
      2: 'hsl(0 0% 24%)',
    },
    text: {
      focus: 'hsl(0 0% 100%)',
      DEFAULT: 'hsl(0 0% 92%)',
      dim: 'hsl(0 0% 84%)',
    },
    primary: {
      DEFAULT: '#80D4FF',
      shade: '#51BFF6',
      tint: '#ADE4FF',
    },
    good: '#34c249',
    warn: '#FFA914',
    bad: '#FF1342',
  },
  borderRadius: {
    none: '0px',
    sm: '0.5rem',
    md: '1rem',
    full: '9999px',
  },
  screen: {
    xs: 480,
    md: 768,
    lg: 1024,
    xl: 1280,
    '2xl': 1536,
  },
  // From https://tailwindcss.com/docs/font-size
  textSize: {
    xs: { fontSize: '0.75rem', lineHeight: '1rem' },
    sm: { fontSize: '0.875rem', lineHeight: '1.25rem' },
    base: { fontSize: '1rem', lineHeight: '1.5rem' },
    lg: { fontSize: '1.125rem', lineHeight: '1.75rem' },
    xl: { fontSize: '1.25rem', lineHeight: '1.75rem' },
    '2xl': { fontSize: '1.5rem', lineHeight: '2rem' },
    '3xl': { fontSize: '1.875rem', lineHeight: '2.25rem' },
    '4xl': { fontSize: '2.25rem', lineHeight: '2.5rem' },
    '5xl': { fontSize: '3rem', lineHeight: '1' },
    '6xl': { fontSize: '3.75rem', lineHeight: '1' },
    '7xl': { fontSize: '4.5rem', lineHeight: '1' },
    '8xl': { fontSize: '6rem', lineHeight: '1' },
    '9xl': { fontSize: '8rem', lineHeight: '1' },
  },
  // From https://tailwindcss.com/docs/padding
  spacePx: (spacing: number): number => THEME.remPx * (spacing / 4),
};

export function toPx(length: string | number): number {
  if (typeof length === 'number') return length;
  return Number.parseFloat(length) * (length.endsWith('rem') ? THEME.remPx : 1);
}
