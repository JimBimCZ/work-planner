'use client';

import { useSyncExternalStore } from 'react';

// The server cannot know the viewer's local clock or locale — lib/due.ts's
// dueState and formatDue both depend on them — so a value derived from either
// must wait until after hydration or the server and client renders can
// disagree. React does not patch a mismatched attribute, so callers gate on
// this and render nothing until it flips to true. Module-level subscribe and
// snapshot functions, not inline arrows, so useSyncExternalStore doesn't
// resubscribe on every render.
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
