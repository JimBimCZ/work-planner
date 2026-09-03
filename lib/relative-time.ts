// One relative-time formatter for the whole app. The board list and the card
// modal's comments both answer "how long ago", and CLAUDE.md forbids a second
// way of doing the same thing.
//
// `now` is a parameter rather than a Date.now() call inside, so the function is
// pure: callers that re-render across midnight pass a fresh now, and tests pass
// a fixed one.
const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const;

export function formatRelative(at: Date, now: Date, locale?: string | string[]): string {
  const elapsed = at.getTime() - now.getTime();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  for (const [unit, milliseconds] of UNITS) {
    if (Math.abs(elapsed) >= milliseconds) {
      return format.format(Math.round(elapsed / milliseconds), unit);
    }
  }
  // Under a minute there is no unit left to fall to, and "0 minutes ago" is
  // both wrong-looking and what numeric:'auto' exists to avoid.
  return format.format(0, 'minute');
}

export function formatAbsolute(at: Date, locale?: string | string[], timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone })
    .format(at);
}
