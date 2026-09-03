// Imports nothing, for the same reason lib/labels-limits.ts and
// lib/attachments-limits.ts do: card-body.tsx is a client component and needs
// the cap to compute its own optimistic preview.
//
// 140 characters is what two clamped lines of a 276px card can show, with
// room to spare. It is also what keeps the card face inside CLAUDE.md's
// payload rule: card.updated never carries the description — 10,000
// characters do not fit under PAYLOAD_CEILING in any encoding — but it does
// carry a preview bounded by construction, at roughly 1.7% of that ceiling.
export const DESCRIPTION_PREVIEW_MAX = 140;

// The stored description is already trimmed by descriptionSchema, and an
// emptied one is stored as null, so the trim here only guards a caller
// holding an uncommitted draft.
export function previewOf(description: string | null): string | null {
  const text = description?.trim();
  return text ? text.slice(0, DESCRIPTION_PREVIEW_MAX) : null;
}
