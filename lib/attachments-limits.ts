// Nothing may be imported here. The file picker is a client component and
// needs ATTACHMENT_SIZE_MAX, so anything this module pulled in would land in
// the browser bundle — see lib/labels-limits.ts, which exists for the same
// reason.

export const ATTACHMENT_SIZE_MAX = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_CARD = 10;

// Ten boards at STORAGE_PER_BOARD is exactly R2's 10 GB-month free tier, so
// the service cannot produce a surprising bill — only a slowly growing legible
// one. STORAGE_PER_ACCOUNT counts an uploader across every board they can
// reach, which is what bounds one member invited to many boards; the board cap
// alone cannot see that. docs/specs/attachments.md holds the arithmetic.
export const STORAGE_PER_BOARD = 1024 * 1024 * 1024;
export const STORAGE_PER_ACCOUNT = 2 * 1024 * 1024 * 1024;

export const FILENAME_MAX = 200;
export const PENDING_TTL_MINUTES = 15;

// Rendered inline; everything else is forced to a download. image/svg+xml is
// deliberately absent — an SVG is a document that can carry script, and a
// viewer who opens one in a tab executes it. Served as a download it is inert.
export const INLINE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
] as const;

export function rendersInline(contentType: string): boolean {
  return (INLINE_IMAGE_TYPES as readonly string[]).includes(contentType);
}
