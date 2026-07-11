/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "var(--s0)",
          1: "var(--s1)",
          2: "var(--s2)",
          3: "var(--s3)",
        },
        line: "var(--line)",
        ink: { 1: "var(--ink1)", 2: "var(--ink2)", 3: "var(--ink3)" },
        accent: { DEFAULT: "#5b8cff", hover: "#729aff", dim: "#243350" },
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
