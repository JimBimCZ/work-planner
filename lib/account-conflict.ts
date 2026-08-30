export function conflictingProvider(existing: string[], incoming: string): string | null {
  if (existing.includes(incoming)) return null;
  return existing[0] ?? null;
}
