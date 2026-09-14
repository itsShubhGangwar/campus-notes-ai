/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc6fc',
          400: '#36a8f8',
          500: '#0c8de9',
          600: '#016fc7',
          700: '#0258a1',
          800: '#064b85',
          900: '#0b3e6f',
          950: '#072749',
        },
      },
    },
  },
  plugins: [],
}
