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
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          hover: "rgb(var(--accent-hover-rgb) / <alpha-value>)",
          dim: "rgb(var(--accent-dim-rgb) / <alpha-value>)",
          ink: "rgb(var(--accent-ink-rgb) / <alpha-value>)",
        },
        // Status colours are theme-aware now. They were fixed hexes tuned for the
        // light surface, so on the dark shell "ok" green and "warn" amber sat
        // below the AA contrast floor against --s1.
        ok: "rgb(var(--ok-rgb) / <alpha-value>)",
        warn: "rgb(var(--warn-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
      },
      fontFamily: {
        // Was ["Inter", …]. Inter is not among the families index.css imports
        // (Plus Jakarta Sans, JetBrains Mono, Silkscreen, Press Start 2P), so
        // every `font-sans` element — and, via preflight, the <html> default —
        // fell back to Segoe UI while <body> rendered in Plus Jakarta Sans.
        // Two typefaces, side by side, in one page. Point both at the token.
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
        pixel: ["var(--font-pixel)"],
      },
      // --- one spacing/typography scale -------------------------------------
      // The 8px system, expressed once. Tailwind's default scale is already
      // 4px-based; these are the named steps the design uses so a component can
      // say `p-card` instead of picking p-4/p-5/p-6 at random.
      spacing: {
        xs: "8px",
        sm: "12px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        card: "20px",
      },
      borderRadius: {
        // One radius ramp. Cards 18px, controls 12px, pills full — matching the
        // values .card/.input/.btn-* use, so a Tailwind-styled one-off lands on
        // the same geometry as a component-class one.
        control: "12px",
        card: "18px",
        panel: "24px",
      },
      // Tailwind v4 utility names that were already in use across AppShell,
      // ui.tsx and Dashboard but do not exist in v3 — they compiled to nothing,
      // so the shadows, the modal backdrop blur and the page fade-in were all
      // silently absent. Defined here rather than rewritten at ~11 call sites.
      boxShadow: {
        "2xs": "0 1px 1px rgb(15 23 42 / 0.04)",
        xs: "0 1px 2px rgb(15 23 42 / 0.06)",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
