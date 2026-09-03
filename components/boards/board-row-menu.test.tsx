// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The action module reaches lib/db, which builds a pg pool at module scope.
vi.mock('@/lib/actions/boards', () => ({ renameBoard: vi.fn(), deleteBoard: vi.fn() }));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  pathname: '/boards',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
  usePathname: () => navigation.pathname,
}));

const { deleteBoard } = await import('@/lib/actions/boards');
const { BoardRowMenu } = await import('@/components/boards/board-row-menu');

afterEach(cleanup);

const board = {
  id: 'b1',
  name: 'Roadmap',
  role: 'owner' as const,
  updatedAt: new Date('2026-09-03T11:00:00Z'),
};

beforeEach(() => {
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  navigation.pathname = '/boards';
  vi.mocked(deleteBoard).mockReset().mockResolvedValue({ ok: true });
});

async function deleteIt() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Board actions for Roadmap' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  await user.type(await screen.findByLabelText('Type the board name to confirm'), 'Roadmap');
  await user.click(screen.getByRole('button', { name: 'Delete board' }));
}

describe('BoardRowMenu', () => {
  test('refreshes the list after deleting a board you are not looking at', async () => {
    render(<BoardRowMenu board={board} />);
    await deleteIt();

    expect(deleteBoard).toHaveBeenCalledWith({ boardId: 'b1', confirmName: 'Roadmap' });
    expect(navigation.refresh).toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  // The menu now also opens from the board's own top bar, where a refresh
  // would re-render the layout onto a board that no longer exists and 404 the
  // user out of the app.
  test('leaves the board you are looking at when you delete it', async () => {
    navigation.pathname = '/boards/b1';
    render(<BoardRowMenu board={board} />);
    await deleteIt();

    expect(navigation.push).toHaveBeenCalledWith('/boards');
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  // An open card is a deeper path under the same board, and it is just as gone.
  test('leaves from a card open on that board too', async () => {
    navigation.pathname = '/boards/b1/cards/c9';
    render(<BoardRowMenu board={board} />);
    await deleteIt();

    expect(navigation.push).toHaveBeenCalledWith('/boards');
  });

  // /boards/b10 starts with /boards/b1. A prefix match would send a user
  // deleting some other board back to the list for no reason.
  test('a board whose id merely prefixes yours is not the one you are on', async () => {
    navigation.pathname = '/boards/b10';
    render(<BoardRowMenu board={board} />);
    await deleteIt();

    expect(navigation.refresh).toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
