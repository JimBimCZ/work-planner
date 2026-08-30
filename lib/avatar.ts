const HUE_START = 180;
const HUE_END = 300;

// Cool half only. A warm avatar would compete with the due-date signal, which is
// the one warm thing in the interface, and the range starts above the accent
// teal so an avatar never impersonates an active state.
export function avatarHue(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 100_000;
  }
  return HUE_START + (hash % (HUE_END - HUE_START + 1));
}

export function initials(name: string | null, email: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return email.slice(0, 1).toUpperCase();
}
