import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    // The colors defined here should be replicated to "src\app\theme.ts"
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      bg: {
        DEFAULT: 'hsl(0 0% 0%)',
        0: 'hsl(0 0% 8%)',
        1: 'hsl(0 0% 16%)',
        2: 'hsl(0 0% 24%)'
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
    extend: {
      screens: {
        xs: '480px',
        hxs: { raw: '(min-height: 480px)' },
        hmd: { raw: '(min-height: 768px)' },
        hlg: { raw: '(min-height: 1024px)' },
        hxl: { raw: '(min-height: 1280px)' },
        h2xl: { raw: '(min-height: 1536px)' },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
