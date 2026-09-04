// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(cleanup);

vi.mock('@/lib/use-mounted', () => ({ useMounted: () => true }));

const { DemoCard } = await import('./demo-card');

const card = {
  id: 'demo-card-migrate',
  title: 'Move attachments to the EU bucket',
  description: 'The bucket has to be created against the EU-jurisdiction endpoint.',
  dueDate: new Date('2026-09-01T00:00:00.000Z'),
  labels: [{ id: 'demo-label-infra', name: 'infra' }],
  comments: [
    {
      id: 'demo-comment-migrate-1',
      body: 'The plain endpoint cannot see the bucket at all.',
      createdAt: new Date('2026-08-31T09:00:00.000Z'),
      author: { id: 'demo-user-rin', name: 'Rin Okabe' },
    },
  ],
};

test('shows what the card holds', () => {
  render(<DemoCard card={card} onClose={() => {}} />);

  expect(screen.getByText('Move attachments to the EU bucket')).toBeTruthy();
  expect(screen.getByText(/EU-jurisdiction endpoint/)).toBeTruthy();
  expect(screen.getByText('infra')).toBeTruthy();
  expect(screen.getByText(/plain endpoint cannot see/)).toBeTruthy();
  expect(screen.getByText('Rin Okabe')).toBeTruthy();
  expect(screen.getByText(/Sep 1/)).toBeTruthy();
});

// Read-only is the whole contract: there is no server behind this dialog.
test('offers nothing to edit with', () => {
  render(<DemoCard card={card} onClose={() => {}} />);

  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(document.querySelectorAll('input, textarea, form')).toHaveLength(0);
});

test('says the demo is read-only rather than leaving a reader guessing', () => {
  render(<DemoCard card={card} onClose={() => {}} />);
  expect(screen.getByText(/Sign in to add a comment/)).toBeTruthy();
});

test('renders a card with no description or comments', () => {
  render(
    <DemoCard
      card={{ ...card, description: null, comments: [], labels: [] }}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText('Move attachments to the EU bucket')).toBeTruthy();
});
