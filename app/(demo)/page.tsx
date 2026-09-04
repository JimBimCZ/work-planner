import { redirect } from 'next/navigation';

import { DemoBoard } from '@/components/demo/demo-board';
import { auth } from '@/lib/auth';
import { demoBoard } from '@/lib/demo-board';

// / is the demo board for anyone signed out, and a redirect for anyone signed
// in. It reads no database: the board comes from lib/demo-board.ts, resolved
// against the request's own clock so its due dates never go stale.
export default async function DemoPage() {
  const session = await auth();
  if (session?.user) redirect('/boards');

  return <DemoBoard board={demoBoard(new Date())} />;
}
