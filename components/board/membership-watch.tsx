'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useRealtime } from '@/components/board/realtime';

export function MembershipWatch({ viewerId }: { viewerId: string }) {
  const { subscribe } = useRealtime();
  const router = useRouter();

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'member.removed' && event.userId === viewerId) {
          router.replace('/boards');
          return;
        }
        // A role change is re-read from the server rather than patched here:
        // canWrite is computed in the layout from the role it just fetched, so
        // a refresh is what makes the board stop offering writes it cannot do.
        if (
          (event.type === 'member.updated' || event.type === 'member.added') &&
          event.userId === viewerId
        ) {
          router.refresh();
        }
      }),
    [subscribe, router, viewerId],
  );

  return null;
}
