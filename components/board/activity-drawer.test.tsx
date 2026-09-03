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
    // A rejection — a dropped connection, a deploy mid-request — not a resolved
    // error shape: openActivity never resolves to UNREACHABLE itself, attempt()
    // maps a rejected call to that at the call site (lib/attempt.ts). Rejecting
    // here drives the real path instead of assuming the wrapping works.
    vi.mocked(openActivity).mockRejectedValue(new Error('network error'));
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
  });

  test('groups activity by calendar day', async () => {
    const now = new Date();
    const yesterdayLine = {
      id: 'y1',
      sentence: 'renamed the column In Review to Review',
      actorId: 'u2',
      actorName: 'Ada',
      actorImage: null,
      createdAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9, 0, 0).toISOString(),
    };
    vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [line, yesterdayLine] } });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  test('folds a few minutes of clock skew into today, not a broken heading', async () => {
    const futureLine = {
      id: 'f1',
      sentence: 'added a comment on Ship it',
      actorId: 'u3',
      actorName: 'Grace',
      actorImage: null,
      createdAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
    vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [futureLine] } });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText('Today')).toBeInTheDocument();
  });
});
