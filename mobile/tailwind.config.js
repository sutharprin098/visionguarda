/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { 0: "#0b0d10", 1: "#111418", 2: "#171b21", 3: "#1f242c" },
        line: "#262c35",
        accent: { DEFAULT: "#5b8cff", hover: "#729aff" },
        ok: "#3fb96b",
        warn: "#e0a83e",
        danger: "#e5534b",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
