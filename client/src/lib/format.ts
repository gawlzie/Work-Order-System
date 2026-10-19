export function formatDateTime(iso: string | null | undefined, locale = 'en-GB') {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Seconds -> "2d 3h 15m" style duration. */
export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds < 60) return seconds ? '< 1m' : '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '0m';
}

export function durationBetween(start: string | null, end: string | null) {
  if (!start) return null;
  const endMs = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((endMs - new Date(start).getTime()) / 1000));
}

export const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
