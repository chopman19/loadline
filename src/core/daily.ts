// Daily puzzle numbering. Voyage #1 sailed on 31 October 2026; a new voyage starts
// at local midnight, so everyone in the same time zone gets the same puzzle all day.

const DAY_MS = 86_400_000;
/** Voyage #1, as a UTC calendar date (only the year/month/day matter). */
export const EPOCH_UTC = Date.UTC(2026, 9, 31);

/** Local calendar date -> voyage number. */
export function dayNumber(date: Date = new Date()): number {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((utc - EPOCH_UTC) / DAY_MS) + 1;
}

/** Voyage number -> local midnight on that calendar date. */
export function dateForDay(n: number): Date {
  const d = new Date(EPOCH_UTC + (n - 1) * DAY_MS);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function msUntilNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function formatDayDate(n: number): string {
  return dateForDay(n).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
