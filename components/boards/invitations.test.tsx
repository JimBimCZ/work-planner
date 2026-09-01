import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

// The action module reaches next-auth, and through it next/server, which does
// not resolve under vitest's node environment. These tests assert markup only.
vi.mock('@/lib/actions/members', () => ({
  acceptInvite: vi.fn(),
  declineInvite: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { Invitations } = await import('./invitations');

const invites = [
  {
    id: 'i1',
    boardId: 'b1',
    boardName: 'Roadmap',
    role: 'member' as const,
    invitedByName: 'Ada',
  },
];

describe('Invitations', () => {
  test('renders nothing when there are none', () => {
    expect(renderToStaticMarkup(<Invitations invites={[]} />)).toBe('');
  });

  test('names who invited you, to what, and as what', () => {
    const html = renderToStaticMarkup(<Invitations invites={invites} />);
    expect(html).toContain('Ada');
    expect(html).toContain('Roadmap');
    expect(html).toMatch(/member/i);
  });

  test('falls back to the board alone when the inviter is gone', () => {
    const html = renderToStaticMarkup(
      <Invitations invites={[{ ...invites[0], invitedByName: null }]} />,
    );
    expect(html).toContain('Roadmap');
    expect(html).toMatch(/you have been invited/i);
  });

  test('offers both answers', () => {
    const html = renderToStaticMarkup(<Invitations invites={invites} />);
    expect(html).toMatch(/accept/i);
    expect(html).toMatch(/decline/i);
  });
});
