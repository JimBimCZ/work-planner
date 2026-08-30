const FALLBACK = 'http://localhost:3000';

// A clean checkout builds with no env file at all, and that is verified in CI, so a
// missing or malformed value falls back rather than throwing during `next build`.
export function siteUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured);
    } catch {
      return new URL(FALLBACK);
    }
  }
  return new URL(FALLBACK);
}
