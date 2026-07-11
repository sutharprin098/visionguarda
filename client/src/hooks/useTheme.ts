import { useEffect } from 'react';

// CamAI is a dark-only enterprise console by design (matches the low-light
// control-room context it's used in). Kept as a hook — rather than an inline
// effect in App.tsx — so the "apply the theme class on mount" concern stays
// in one place if that ever changes.
export function useTheme() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  }, []);

  return { theme: 'dark' as const };
}
