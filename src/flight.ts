// Flight helpers shared by the Flown screen, the session screen and the log panel.
import type { FlightType } from './types';

const LAST_TYPE_KEY = 'smj-last-flight-type';

/** Flight types in the order staff reach for them (experiences are the most common) */
export const FLIGHT_ORDER: FlightType[] = ['experience', 'display', 'training', 'school', 'other'];

/** The type used last on this phone, so the usual one is ready to tap */
export function lastFlightType(): FlightType {
  try {
    const t = localStorage.getItem(LAST_TYPE_KEY) as FlightType | null;
    return t && FLIGHT_ORDER.includes(t) ? t : 'experience';
  } catch {
    return 'experience';
  }
}

export function rememberFlightType(t: FlightType) {
  try {
    localStorage.setItem(LAST_TYPE_KEY, t);
  } catch {
    /* ignore */
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Today at HH:MM, or null if not a valid time */
export function todayAt(time: string): Date | null {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
