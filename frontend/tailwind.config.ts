import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      screens: {
        // Mobile breakpoint used for the collapsible sidebar (Req 8.5).
        mobile: { max: '767px' },
      },
    },
  },
  plugins: [],
};

export default config;
