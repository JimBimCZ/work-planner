type OrderedRow = { id: string; createdAt: Date };

// Places a rejected delete's row back by thread order — createdAt, then id,
// the same order getCardForView sorts the thread by — rather than a captured
// array index, which a concurrent removal can make stale before the
// rejection arrives. Kept out of card-comments.tsx so it can be unit tested
// without pulling in that module's server-action imports.
export function reinsertOrdered<T extends OrderedRow>(current: T[], row: T): T[] {
  const index = current.findIndex(
    (r) =>
      r.createdAt.getTime() > row.createdAt.getTime() ||
      (r.createdAt.getTime() === row.createdAt.getTime() && r.id > row.id),
  );
  return index === -1
    ? [...current, row]
    : [...current.slice(0, index), row, ...current.slice(index)];
}
