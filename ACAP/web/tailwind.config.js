/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#0b0d10", // Page canvas background (deep slate black)
          1: "#12161f", // Pure dark panels, sidebars, headers, cards
          2: "#1a202c", // Slate dark button / input background
          3: "#2d3748", // Dark border / hover background
        },
        line: "#2d3748",
        "line-hover": "#4a5568",
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
