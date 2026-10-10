// Melbourne's real UTC offset at a given instant — +10h (AEST) or +11h (AEDT).
// Replaces the old hardcoded `10 * 60 * 60 * 1000`, which ran an hour behind
// from the first Sunday of October to the first Sunday of April.
// Usage pattern stays the same: new Date(t + melbOffsetMs(t)), then read getUTC*.
const fmt = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Melbourne',
  timeZoneName: 'longOffset', // e.g. "GMT+11:00"
});

export function melbOffsetMs(at: number = Date.now()): number {
  const tz = fmt.formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = tz.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 10 * 60 * 60 * 1000; // fallback: AEST
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60 * 1000;
}

// Shorthand: a Date whose UTC fields read as Melbourne wall-clock time.
export function melbNowDate(): Date {
  const now = Date.now();
  return new Date(now + melbOffsetMs(now));
}
