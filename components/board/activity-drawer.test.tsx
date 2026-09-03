// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The action module reaches lib/db, which builds a pg pool at module scope.
vi.mock('@/lib/actions/activity', () => ({ openActivity: vi.fn() }));

const { openActivity } = await import('@/lib/actions/activity');
const { ActivityDrawer } = await import('@/components/board/activity-drawer');

// vitest.config.mts does not set globals: true, so Testing Library never
// registers its own afterEach(cleanup). Wire it by hand or the DOM leaks.
afterEach(cleanup);

const line = {
  id: 'a1',
  sentence: 'moved Ship it to In Review',
  actorId: 'u1',
  actorName: 'Vit',
  actorImage: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [line] } });
});

describe('ActivityDrawer', () => {
  test('reads the feed when it opens, not before', async () => {
    render(<ActivityDrawer boardId="b1" />);
    expect(openActivity).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    await waitFor(() => expect(openActivity).toHaveBeenCalledWith({ boardId: 'b1' }));
    expect(await screen.findByText(/moved Ship it to In Review/)).toBeInTheDocument();
    expect(screen.getByText('Vit')).toBeInTheDocument();
  });

  test('invites rather than apologises when the board is new', async () => {
    vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [] } });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  });

  test('says what happened when the read fails', async () => {
    // openActivity itself never resolves to UNREACHABLE — attempt() maps a
    // rejected call to that shape at the call site. Resolving with it here
    // is the simplest way to drive the drawer through its failed state.
    // @ts-expect-error UNREACHABLE is attempt()'s shape, not openActivity's own.
    vi.mocked(openActivity).mockResolvedValue({ ok: false, error: 'UNREACHABLE' });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
  });
});
