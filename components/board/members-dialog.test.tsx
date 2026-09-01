import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

// The action module reaches next-auth, and through it next/server, which does
// not resolve under vitest's node environment. These tests assert markup only.
vi.mock('@/lib/actions/members', () => ({
  leaveBoard: vi.fn(),
  inviteMember: vi.fn(),
  revokeInvite: vi.fn(),
  changeRole: vi.fn(),
  removeMember: vi.fn(),
}));
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

const invites = [
  { id: 'i1', email: 'waiting@example.test', role: 'member' as const, createdAt: new Date(0) },
];

describe('MembersPanel, as the owner', () => {
  const asOwner = { viewerId: 'u1', isOwner: true, invites };

  test('offers a field to invite an address', () => {
    const html = render(asOwner);
    expect(html).toMatch(/invite by email/i);
    expect(html).toContain('type="email"');
  });

  test('lists an invite that has not been answered yet', () => {
    expect(render(asOwner)).toContain('waiting@example.test');
  });

  test('offers to take a pending invite back', () => {
    expect(render(asOwner)).toMatch(/revoke/i);
  });

  test('shows a non-owner none of it', () => {
    const html = render({ invites });
    expect(html).not.toMatch(/invite by email/i);
    expect(html).not.toContain('waiting@example.test');
  });
});

describe('MembersPanel role controls', () => {
  test('lets the owner change a member role and remove them', () => {
    const html = render({ viewerId: 'u1', isOwner: true });
    expect(html).toContain('aria-label="Role for Grace"');
    expect(html).toMatch(/remove/i);
  });

  // One owner row is the invariant the whole design rests on: no control in
  // this dialog may offer to demote or remove the owner.
  test('offers no role control and no remove against the owner row', () => {
    const html = render({ viewerId: 'u1', isOwner: true });
    expect(html).not.toContain('aria-label="Role for Ada"');
  });

  test('shows a non-owner no controls at all', () => {
    const html = render();
    expect(html).not.toContain('aria-label="Role for Grace"');
    expect(html).not.toMatch(/remove/i);
  });
});
