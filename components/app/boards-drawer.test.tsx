// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

// Both action modules reach lib/db, which builds a pg pool at module scope.
vi.mock('@/lib/actions/boards', () => ({
  createBoard: vi.fn(),
  renameBoard: vi.fn(),
  deleteBoard: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/boards/b1',
}));

const { BoardsDrawer } = await import('@/components/app/boards-drawer');

// vitest.config.mts does not set globals: true, so Testing Library never
// registers its own afterEach(cleanup).
afterEach(cleanup);

const boards = [
  { id: 'b1', name: 'Roadmap', role: 'owner' as const, updatedAt: new Date('2026-09-03T11:00:00Z') },
  { id: 'b2', name: 'Bugs', role: 'viewer' as const, updatedAt: new Date('2026-09-01T11:00:00Z') },
];

describe('BoardsDrawer', () => {
  test('costs nothing until it is opened', () => {
    render(<BoardsDrawer boards={boards} currentBoardId="b1" />);

    expect(screen.getByRole('button', { name: 'Boards' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Bugs' })).not.toBeInTheDocument();
  });

  test('opens onto every board you can reach, and offers a new one', async () => {
    render(<BoardsDrawer boards={boards} currentBoardId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Boards' }));

    expect(screen.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('href', '/boards/b1');
    expect(screen.getByRole('link', { name: 'Bugs' })).toHaveAttribute('href', '/boards/b2');
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
  });

  test('says which board you are already on', async () => {
    render(<BoardsDrawer boards={boards} currentBoardId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Boards' }));

    expect(screen.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Bugs' })).not.toHaveAttribute('aria-current');
  });

  // Management is the row menu the /boards page already carries, not a second
  // implementation of rename and delete.
  test('carries the row menu on a board you own, and not on one you do not', async () => {
    render(<BoardsDrawer boards={boards} currentBoardId="b1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Boards' }));

    expect(screen.getByRole('button', { name: 'Board actions for Roadmap' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Board actions for Bugs' })).not.toBeInTheDocument();
  });
});
