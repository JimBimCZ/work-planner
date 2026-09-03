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
  vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [line], seenAt: null } });
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
    vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [], seenAt: null } });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    // The same text also lands in the sr-only live region (finding 7), so
    // scope to the visible paragraph specifically.
    expect(
      await screen.findByText('Nothing here yet', { selector: 'p.mt-4' }),
    ).toBeInTheDocument();
  });

  test('says what happened when the read fails', async () => {
    // A rejection — a dropped connection, a deploy mid-request — not a resolved
    // error shape: openActivity never resolves to UNREACHABLE itself, attempt()
    // maps a rejected call to that at the call site (lib/attempt.ts). Rejecting
    // here drives the real path instead of assuming the wrapping works.
    vi.mocked(openActivity).mockRejectedValue(new Error('network error'));
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    // The same text also lands in the sr-only live region (finding 7), so
    // scope to the visible paragraph specifically.
    expect(
      await screen.findByText(/could not load/i, { selector: 'p.mt-4' }),
    ).toBeInTheDocument();
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
    vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [line, yesterdayLine], seenAt: null } });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  test('folds a few minutes of clock skew into today, not a broken heading', async () => {
    // Built from calendar components, the same way the day-boundary test
    // above is, rather than Date.now() + 5 minutes: that arithmetic lands on
    // tomorrow's calendar day for the last five minutes before local
    // midnight, which is exactly the skew this test exists to cover, but
    // only ~0.35% of the time it ran. Dating the fixture to just past
    // midnight tomorrow reproduces that skew on every run, at any hour.
    const now = new Date();
    const futureLine = {
      id: 'f1',
      sentence: 'added a comment on Ship it',
      actorId: 'u3',
      actorName: 'Grace',
      actorImage: null,
      createdAt: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        5,
        0,
      ).toISOString(),
    };
    vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [futureLine], seenAt: null } });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText('Today')).toBeInTheDocument();
  });

  test('wraps a long unbroken filename instead of overflowing the row', async () => {
    const longName = 'a'.repeat(200);
    const overflowLine = {
      id: 'o1',
      sentence: `attached ${longName} to Ship it`,
      actorId: 'u4',
      actorName: 'Priya',
      actorImage: null,
      createdAt: new Date().toISOString(),
    };
    vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [overflowLine], seenAt: null } });
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    const sentence = await screen.findByText(new RegExp(longName));
    expect(sentence).toHaveClass('break-words');
  });

  test("renders the actor's avatar image when one is present", async () => {
    const imageLine = {
      ...line,
      id: 'i1',
      actorImage: 'https://avatars.githubusercontent.com/u/1',
    };
    vi.mocked(openActivity).mockResolvedValue({ ok: true, data: { lines: [imageLine], seenAt: null } });
    // Sheet content is a Radix Portal onto document.body, not a descendant of
    // render()'s own container — query the document, the way screen does.
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));
    await screen.findByText(/moved Ship it to In Review/);

    expect(document.querySelector('img')).toHaveAttribute('alt', '');
  });

  test('falls back to initials-on-hue when the actor has no image', async () => {
    render(<ActivityDrawer boardId="b1" />);

    await userEvent.click(screen.getByRole('button', { name: /activity/i }));

    await screen.findByText(/moved Ship it to In Review/);
    expect(document.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('V')).toBeInTheDocument();
  });
});
