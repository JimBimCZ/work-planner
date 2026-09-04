import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

// AccountMenu reaches lib/actions/session, which imports lib/auth and
// therefore lib/db's pool. The bar's own behaviour is what is under test.
vi.mock('@/components/app/account-menu', () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));

const { TopBar } = await import('./top-bar');

const viewer = {
  userId: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  image: null,
};

test('renders the account menu for a signed-in viewer', () => {
  const html = renderToStaticMarkup(<TopBar viewer={viewer} title="Roadmap" />);
  expect(html).toContain('account-menu');
  expect(html).toContain('Roadmap');
});

// The demo is served to someone with no session, so there is no account to
// put in a menu — and the privacy link the board hides in that menu has to
// move into the bar's actions instead.
test('renders no account menu without a viewer', () => {
  const html = renderToStaticMarkup(<TopBar title="Launch checklist" />);
  expect(html).not.toContain('account-menu');
  expect(html).toContain('Launch checklist');
});

test('renders its actions either way', () => {
  const html = renderToStaticMarkup(<TopBar actions={<a href="/privacy">Privacy</a>} />);
  expect(html).toContain('/privacy');
});
