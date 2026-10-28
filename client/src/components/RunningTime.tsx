import { useEffect, useState } from 'react';
import { formatDuration } from '../lib/format';
import type { WoStatus } from '../lib/types';

/** Work orders whose total time is still counting: being worked on, or waiting between steps. */
export const isRunning = (status: WoStatus) => status === 'ON_PROGRESS' || status === 'WAITING';

/**
 * A duration that keeps counting every second while `running`: the server's value plus the time since it was
 * fetched (`since`, ms), so a device clock that is off does not matter.
 */
export function RunningTime({ seconds, since, running }: { seconds: number; since: number; running: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [running]);
  const value = running && since ? seconds + Math.max(0, Math.floor((now - since) / 1000)) : seconds;
  return <>{formatDuration(value)}</>;
}
