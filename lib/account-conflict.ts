export function conflictingProvider(existing: string[], incoming: string): string | null {
  if (existing.includes(incoming)) return null;
  return existing[0] ?? null;
}


const PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
] as const;

export type SupportedProvider = (typeof PROVIDERS)[number];

// Narrows as well as labels: the id reaches signIn() as a provider name, and it
// arrives off a URL. A find over a literal tuple gives the narrow type without a
// cast, and without an object literal's `__proto__` hazard.
export function supportedProvider(id: string | undefined): SupportedProvider | null {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}
