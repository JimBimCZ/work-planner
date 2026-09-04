// @vitest-environment jsdom
// vitest.config.mts registers no setupFiles, so the matchers below
// (toHaveClass, toBeInTheDocument, toHaveTextContent) come from here or not
// at all. components/board/card-comments.test.tsx:2 is the convention.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DemoTour } from '@/components/demo/demo-tour';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

// jsdom implements no matchMedia, and the tour reads it for
// prefers-reduced-motion. Stubbed per file rather than in a setup file,
// matching the per-file jsdom pragma this repo uses.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

// jsdom gives every element a 0x0 box, which visibleSteps reads as absent —
// so without this only the opening step would survive and the sequence under
// test would be one step long.
beforeEach(() => {
  // Seeded rather than cleared: with the flag absent the tour opens itself,
  // and Radix aria-hides everything behind it — so every test that drives the
  // tour by hand would lose the top bar control it clicks. The four tests that
  // want a first visit call firstVisit(). e2e/demo-fixture.ts seeds the same
  // key for the same reason.
  localStorage.clear();
  localStorage.setItem('demo-tour', 'seen');
  // cleanup() unmounts React trees; it does not remove nodes this hook
  // appended. Without the reset, the "drops a step" test still finds the
  // previous test's column and the counter never falls to 4.
  document.body.innerHTML = '';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 10,
    left: 10,
    width: 100,
    height: 40,
  } as DOMRect);
  Element.prototype.scrollIntoView = vi.fn();
  for (const step of ['demo-card-migrate', 'demo-card-drag']) {
    const el = document.createElement('div');
    el.setAttribute('data-card-id', step);
    document.body.append(el);
  }
  const column = document.createElement('div');
  column.setAttribute('data-column-id', 'demo-col-done');
  document.body.append(column);
  const signin = document.createElement('a');
  signin.setAttribute('data-tour', 'signin');
  document.body.append(signin);
});

const firstVisit = () => localStorage.clear();

const open = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'What can I try?' }));
  return user;
};

it('opens on the first step and counts the whole sequence', async () => {
  render(<DemoTour />);
  await open();

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('A board you can poke at')).toBeInTheDocument();
  expect(screen.getByText('1 of 5')).toBeInTheDocument();
});

it('walks forward and back', async () => {
  render(<DemoTour />);
  const user = await open();

  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Open a card')).toBeInTheDocument();
  expect(screen.getByText('2 of 5')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('A board you can poke at')).toBeInTheDocument();
});

it('has no Back on the first step and finishes on the last', async () => {
  render(<DemoTour />);
  const user = await open();

  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

  for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: /Next|Done/ }));
  expect(screen.getByText('5 of 5')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('skips out of the middle', async () => {
  render(<DemoTour />);
  const user = await open();

  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('reopens at the first step', async () => {
  render(<DemoTour />);
  const user = await open();

  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Skip' }));
  await user.click(screen.getByRole('button', { name: 'What can I try?' }));

  expect(screen.getByText('1 of 5')).toBeInTheDocument();
});

it('drops a step whose element is not there, and says so in the counter', async () => {
  document.querySelector('[data-column-id="demo-col-done"]')?.remove();
  render(<DemoTour />);
  await open();

  expect(screen.getByText('1 of 4')).toBeInTheDocument();
});

it('announces the step body politely', async () => {
  render(<DemoTour />);
  await open();

  const live = screen.getByRole('dialog').querySelector('[aria-live="polite"]');
  expect(live).toHaveTextContent('Everything here works.');
});

it('opens itself on a first visit', async () => {
  firstVisit();
  render(<DemoTour />);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('A board you can poke at')).toBeInTheDocument();
});

it('does not open when it has been seen', () => {
  localStorage.setItem('demo-tour', 'seen');
  render(<DemoTour />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('remembers a skip', async () => {
  firstVisit();
  render(<DemoTour />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Skip' }));
  expect(localStorage.getItem('demo-tour')).toBe('seen');
});

it('remembers reaching the end', async () => {
  firstVisit();
  render(<DemoTour />);
  const user = userEvent.setup();
  await screen.findByRole('dialog');
  for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(localStorage.getItem('demo-tour')).toBe('seen');
});

it('renders when localStorage throws', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  render(<DemoTour />);

  // A browser that refuses to remember cannot report the tour as seen, so it
  // opens every visit — the harmless direction markSeen's comment names. What
  // matters is that the throw is contained and the component still renders.
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});
