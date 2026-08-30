export function safeCallbackUrl(raw: string | null | undefined, fallback = '/boards'): string {
  if (!raw) return fallback;
  // `//host` and `/\host` are both read as protocol-relative by browsers, so a
  // leading slash alone does not prove the target is our own origin.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return fallback;
  }
  return raw;
}
