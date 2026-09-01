import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

// The action module reaches next-auth, and through it next/server, which does
// not resolve under vitest's node environment. These tests assert markup only.
vi.mock('@/lib/actions/members', () => ({ leaveBoard: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { MembersPanel } = await import('./members-dialog');

const members = [
  { userId: 'u1', name: 'Ada', email: null, image: null, role: 'owner' as const },
  { userId: 'u2', name: 'Grace', email: null, image: null, role: 'viewer' as const },
];

const render = (props: Partial<Parameters<typeof MembersPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <MembersPanel
      boardId="board-1"
      boardName="Roadmap"
      viewerId="u2"
      isOwner={false}
      members={members}
      invites={[]}
      {...props}
    />,
  );

describe('MembersPanel', () => {
  test('names everyone on the board and their role', () => {
    const html = render();
    expect(html).toContain('Ada');
    expect(html).toContain('Grace');
    expect(html).toMatch(/viewer/i);
  });

  test('offers a non-owner the way out', () => {
    expect(render()).toMatch(/leave board/i);
  });

  test('does not offer the owner a way to leave their own board', () => {
    const html = render({ viewerId: 'u1', isOwner: true });
    // Proves the panel rendered at all, so the absence below means something.
    expect(html).toContain('Ada');
    expect(html).not.toMatch(/leave board/i);
  });
});
