const TZ = 'Europe/London';

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Calendar date in Europe/London as YYYY-MM-DD */
export function londonDate(d: Date = new Date()): string {
  return dateFmt.format(d);
}

/** ISO weekday (1 = Mon ... 7 = Sun) for a YYYY-MM-DD date */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** e.g. "Fri 3 Oct" */
export function formatDay(date: string): string {
  return dayFmt.format(new Date(`${date}T12:00:00Z`));
}
