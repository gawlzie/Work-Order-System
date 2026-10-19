import { useEffect, useState } from 'react';

/** Light / dark theme toggle, remembered per browser. */
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('wos-theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);
  return [dark, setDark] as const;
}
