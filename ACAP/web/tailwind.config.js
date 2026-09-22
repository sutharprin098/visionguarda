/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#f8fafc", // Page canvas background (slate-50)
          1: "#ffffff", // Pure white panels, sidebars, headers, cards
          2: "#f1f5f9", // Crisp light grey button / input background (slate-100)
          3: "#e2e8f0", // Subtle border / hover background (slate-200)
        },
        line: "#e2e8f0",
        "line-hover": "#cbd5e1",
        accent: { DEFAULT: "#2563eb", hover: "#1d4ed8" },
        ok: "#16a34a",
        warn: "#d97706",
        danger: "#dc2626",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
