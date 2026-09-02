// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { CardAttachments } from '@/components/board/card-attachments';
import type { CardAttachment } from '@/lib/attachments';

// This repo does not set vitest's `globals: true` (see vitest.config.mts), so
// @testing-library/react's automatic afterEach(cleanup) — which only wires
// itself up when it detects a global `afterEach` — never registers. Without
// this, DOM from one test leaks into the next.
afterEach(cleanup);

const file = (over: Partial<CardAttachment> = {}) => ({
  id: 'a1',
  filename: 'screenshot.png',
  contentType: 'image/png',
  size: 2048,
  createdAt: new Date('2026-09-02T10:00:00Z'),
  uploader: { id: 'u1', name: 'Alex', image: null },
  ...over,
});

const props = {
  cardId: 'c1',
  canWrite: true,
  viewerId: 'u1',
  viewerIsOwner: false,
  storageEnabled: true,
  boardUsed: 0,
  onChange: () => {},
};

describe('CardAttachments', () => {
  test('renders an inline-safe image as an image', () => {
    render(<CardAttachments {...props} attachments={[file()]} />);
    expect(screen.getByRole('img', { name: 'screenshot.png' })).toHaveAttribute(
      'src',
      '/api/attachments/a1',
    );
  });

  test('renders a PDF as a named download, not an image', () => {
    render(
      <CardAttachments
        {...props}
        attachments={[file({ contentType: 'application/pdf', filename: 'spec.pdf' })]}
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /spec\.pdf/ })).toHaveAttribute(
      'href',
      '/api/attachments/a1',
    );
  });

  test('never renders an SVG inline', () => {
    render(
      <CardAttachments
        {...props}
        attachments={[file({ contentType: 'image/svg+xml', filename: 'logo.svg' })]}
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('shows the size in a mono face', () => {
    render(<CardAttachments {...props} attachments={[file({ size: 2048 })]} />);
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  test('says so when there is nothing attached', () => {
    // An invitation, not an apology — CLAUDE.md's copy rules.
    render(<CardAttachments {...props} attachments={[]} />);
    expect(screen.getByText('Nothing attached yet')).toBeInTheDocument();
  });

  test('offers no upload control to a viewer', () => {
    render(<CardAttachments {...props} canWrite={false} attachments={[file()]} />);
    expect(screen.queryByRole('button', { name: /add file/i })).not.toBeInTheDocument();
  });

  test('offers no upload control when no bucket is configured', () => {
    // The supported self-hosting configuration: a working board, no surface.
    render(<CardAttachments {...props} storageEnabled={false} attachments={[]} />);
    expect(screen.queryByRole('button', { name: /add file/i })).not.toBeInTheDocument();
  });

  test('hides the section entirely when storage is off and nothing is attached', () => {
    render(<CardAttachments {...props} storageEnabled={false} attachments={[]} />);
    expect(screen.queryByText('Attachments')).not.toBeInTheDocument();
  });

  test('shows no usage line below 80% of the board cap', () => {
    render(<CardAttachments {...props} boardUsed={100 * 1024 * 1024} attachments={[file()]} />);
    expect(screen.queryByText(/of 1 GB used/)).not.toBeInTheDocument();
  });

  test('warns once the board passes 80%', () => {
    // A quota is only fair if you can see it coming.
    render(<CardAttachments {...props} boardUsed={900 * 1024 * 1024} attachments={[file()]} />);
    expect(screen.getByText(/of 1 GB used/)).toBeInTheDocument();
  });
});
