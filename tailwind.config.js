/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'theme-red': '#d33f2f',
        'theme-red-dark': '#c62829',
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false, // 禁用Tailwind的基础样式重置，避免与Ant Design冲突
  },
}
