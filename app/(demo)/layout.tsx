import Link from 'next/link';

import { TopBar } from '@/components/app/top-bar';
import { BoardActionsProvider } from '@/components/board/board-actions';
import { RealtimeProvider } from '@/components/board/realtime';
import { DemoTour } from '@/components/demo/demo-tour';
import { DEMO_BOARD_NAME } from '@/lib/demo-board';

// The (board) treatment: fixed viewport height, body scroll locked, and no
// SiteFooter — a footer below a locked viewport is unreachable. The privacy
// link the board view hides in the account menu lives in the bar here,
// because a visitor with no session has no account menu.
//
// There is no auth() call in this layout. Nothing here is authorised: the
// demo is public, and the redirect for a signed-in visitor is a convenience
// that belongs in the one place that decides what to render.
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider boardId={null}>
      <BoardActionsProvider>
        <div className="flex h-screen flex-col overflow-hidden">
          <TopBar
            title={DEMO_BOARD_NAME}
            actions={
              <>
                <span className="hidden font-mono text-xs text-muted min-[700px]:inline">
                  Nothing here is saved
                </span>
                <span className="font-mono text-xs text-muted min-[700px]:hidden">Demo</span>
                <DemoTour />
                <Link
                  href="/privacy"
                  className="rounded-[var(--radius-control)] text-[13px] text-muted hover:text-ink"
                >
                  Privacy
                </Link>
                <Link
                  href="/signin"
                  data-tour="signin"
                  className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-[13px] font-medium text-white"
                >
                  Sign in
                </Link>
              </>
            }
          />
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      </BoardActionsProvider>
    </RealtimeProvider>
  );
}
