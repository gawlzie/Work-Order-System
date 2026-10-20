export function formatDateTime(iso: string | null | undefined, locale = 'en-GB') {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Seconds -> duration down to the second: "45s", "3m 05s", "2h 03m 15s", "1d 4h 00m 00s"; 0 or null -> "-". */
export function formatDuration(seconds: number | null | undefined) {
  // No time yet (e.g. a work order that has not started) shows '-'.
  if (!seconds || seconds < 0) return '-';
  const total = Math.max(0, Math.round(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d) return `${d}d ${h}h ${pad(m)}m ${pad(s)}s`;
  if (h) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

export function durationBetween(start: string | null, end: string | null) {
  if (!start) return null;
  const endMs = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((endMs - new Date(start).getTime()) / 1000));
}

export const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** ISO time as the value of a datetime-local input (local time, with seconds). */
export const toDateTimeInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${toDateInput(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** datetime-local value (local time) as ISO, or '' when empty or invalid. */
export const fromDateTimeInput = (value: string) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : '';
};

export const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
