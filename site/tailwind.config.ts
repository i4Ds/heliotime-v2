import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      screens: {
        vsm: { raw: '(min-height: 560px)' },
      },
    },
  },
  plugins: [],
};
export default config;
