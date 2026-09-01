type Unreachable = { ok: false; error: 'UNREACHABLE' };

// A server action is a fetch, so it does not only *return* a refusal — it can
// reject outright: the browser is offline, the connection drops, a deploy lands
// mid-request. Every caller here runs inside startTransition, and an unhandled
// rejection there reaches the nearest error boundary, which replaces the whole
// board with "This page couldn't load" — taking the columns, the cards, every
// optimistic change and the status strip that would have explained it.
//
// A request that never arrived and one the server refused have the same
// meaning to the caller: the write did not happen, so roll back and say so.
// Giving them the same shape is what lets one rollback path serve both.
export function attempt<T extends { ok: boolean }>(
  call: () => Promise<T>,
): Promise<T | Unreachable> {
  // The call itself is inside the try: a synchronous throw before the promise
  // exists would otherwise escape the .catch entirely.
  try {
    return Promise.resolve(call()).catch(unreachable);
  } catch {
    return Promise.resolve(unreachable());
  }
}

const unreachable = (): Unreachable => ({ ok: false, error: 'UNREACHABLE' });
