import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "dark" | "light";
// "light" — matching the provider's own default below. These disagreed: the
// context fell back to "dark" while the provider initialises to "light", so
// anything reading useTheme() before/outside the provider (charts.tsx picks its
// series and grid colors from it) chose dark-theme colors for a light page.
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("camai-theme");
    return (saved === "light" || saved === "dark") ? saved : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("camai-theme", theme);
  }, [theme]);

  return (
    <Ctx.Provider value={{ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}>
      {children}
    </Ctx.Provider>
  );
}
