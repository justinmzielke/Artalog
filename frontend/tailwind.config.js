/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['\"Inter\"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        graphite: {
          50: '#f6f6f5',
          100: '#ececeb',
          200: '#d8d7d5',
          300: '#b8b7b3',
          400: '#8f8d88',
          500: '#6f6d68',
          600: '#55534f',
          700: '#3f3d3a',
          800: '#2d2c2a',
          900: '#1f1f1e',
        },
      },
    },
  },
  plugins: [],
};
