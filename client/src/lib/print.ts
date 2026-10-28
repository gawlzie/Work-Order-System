import { useEffect } from 'react';

/** Today as YYYY-MM-DD in local time. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * While the page prints (the Print button or Ctrl+P), the page title is `<name>_<print date>`: browsers use it as the
 * file name of "Save as PDF".
 */
export function usePrintFileName(name: string | undefined) {
  useEffect(() => {
    if (!name) return;
    let saved: string | null = null;
    const before = () => {
      saved = document.title;
      document.title = `${name}_${localDate()}`;
    };
    const after = () => {
      if (saved != null) document.title = saved;
      saved = null;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      after();
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [name]);
}
