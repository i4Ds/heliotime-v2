import type { Config } from 'tailwindcss';
import type { PluginUtils } from 'tailwindcss/types/config';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}', './mdx-components.tsx'],
  theme: {
    // The colors defined here should be replicated to "src\app\theme.ts"
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      bg: {
        DEFAULT: 'hsl(0 0% 0%)',
        0: 'hsl(0 0% 8%)',
        1: 'hsl(0 0% 16%)',
        2: 'hsl(0 0% 24%)',
      },
      text: {
        focus: 'hsl(0 0% 100%)',
        DEFAULT: 'hsl(0 0% 90%)',
        dim: 'hsl(0 0% 76%)',
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
    extend: {
      screens: {
        xs: '480px',
        hxs: { raw: '(min-height: 480px)' },
        hmd: { raw: '(min-height: 768px)' },
        hlg: { raw: '(min-height: 1024px)' },
        hxl: { raw: '(min-height: 1280px)' },
        h2xl: { raw: '(min-height: 1536px)' },
      },
      typography: ({ theme }: PluginUtils) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': theme('colors.text'),
            '--tw-prose-headings': theme('colors.text.focus'),
            '--tw-prose-lead': theme('colors.text.focus'),
            '--tw-prose-links': theme('colors.text.focus'),
            '--tw-prose-bold': theme('colors.text.focus'),
            '--tw-prose-counters': theme('colors.text.focus'),
            '--tw-prose-bullets': theme('colors.bg.2'),
            '--tw-prose-hr': theme('colors.bg.1'),
            '--tw-prose-quotes': theme('colors.text.focus'),
            '--tw-prose-quote-borders': theme('colors.bg.1'),
            '--tw-prose-captions': theme('colors.text.focus'),
            '--tw-prose-kbd': theme('colors.text.focus'),
            '--tw-prose-kbd-shadows': theme('colors.text.focus'),
            '--tw-prose-code': theme('colors.text.focus'),
            '--tw-prose-pre-code': theme('colors.text'),
            '--tw-prose-pre-bg': 'rgb(0 0 0 / 50%)',
            '--tw-prose-th-borders': theme('colors.bg.2'),
            '--tw-prose-td-borders': theme('colors.bg.1'),
          },
        },
      }),
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
};
export default config;
