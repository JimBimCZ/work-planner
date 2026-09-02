// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { CardAttachment } from '@/lib/attachments';

// The action module reaches lib/db, which builds a pg pool at module scope and
// does not resolve under vitest's node-backed jsdom environment.
vi.mock('@/lib/actions/attachments', () => ({
  requestUpload: vi.fn(),
  confirmUpload: vi.fn(),
  deleteAttachment: vi.fn(),
}));

const { requestUpload, confirmUpload, deleteAttachment } = await import('@/lib/actions/attachments');
const { CardAttachments } = await import('@/components/board/card-attachments');

// jsdom performs no network I/O, so a presigned PUT never actually happens and
// no upload.progress event ever fires. This stub reports exactly one progress
// tick and a 200, which is enough to exercise both the progress bar and the
// confirmUpload call that follows it.
class FakeXHR {
  upload = { addEventListener: (type: string, cb: (event: unknown) => void) => {
    this.uploadListeners[type] = [...(this.uploadListeners[type] ?? []), cb];
  } };
  status = 200;
  private uploadListeners: Record<string, Array<(event: unknown) => void>> = {};
  private listeners: Record<string, Array<() => void>> = {};

  open() {}
  setRequestHeader() {}
  addEventListener(type: string, cb: () => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), cb];
  }
  send() {
    // A real PUT takes a real round trip. userEvent.upload's own act() flush
    // settles (and hands control back to the test) within a couple of
    // milliseconds; firing these on a real macrotask past that point is what
    // lets the in-flight render actually commit instead of being collapsed
    // into the final one. findByRole/waitFor then pick the result up on their
    // own polling, well inside their default timeout.
    setTimeout(() => {
      this.uploadListeners.progress?.forEach((cb) =>
        cb({ lengthComputable: true, loaded: 1, total: 1 }),
      );
      this.listeners.load?.forEach((cb) => cb());
    }, 20);
  }
}

// This repo does not set vitest's `globals: true` (see vitest.config.mts), so
// @testing-library/react's automatic afterEach(cleanup) — which only wires
// itself up when it detects a global `afterEach` — never registers. Without
// this, DOM from one test leaks into the next.
afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.mocked(requestUpload).mockReset().mockResolvedValue({
    ok: true,
    data: { attachmentId: 'new-id', url: 'https://example.com/put' },
  });
  vi.mocked(confirmUpload).mockReset().mockResolvedValue({
    ok: true,
    data: { attachmentId: 'new-id' },
  });
  vi.mocked(deleteAttachment).mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
});

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
    expect(screen.queryByLabelText(/add file/i)).not.toBeInTheDocument();
  });

  test('offers no upload control when no bucket is configured', () => {
    // The supported self-hosting configuration: a working board, no surface.
    render(<CardAttachments {...props} storageEnabled={false} attachments={[]} />);
    expect(screen.queryByRole('button', { name: /add file/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/add file/i)).not.toBeInTheDocument();
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

  test('rejects a file over the size cap without calling the server', async () => {
    // The client knows the cap, so an over-cap file is refused before a round
    // trip. The 40 MB claim is a stubbed `size`, not 40 MB of real bytes.
    const huge = new File(['x'], 'huge.bin');
    Object.defineProperty(huge, 'size', { value: 40 * 1024 * 1024 });

    render(<CardAttachments {...props} attachments={[]} />);
    await userEvent.upload(screen.getByLabelText(/add file/i), huge);
    expect(await screen.findByText(/is larger than the 10 MB limit/i)).toBeInTheDocument();
    expect(requestUpload).not.toHaveBeenCalled();
  });

  test('reports a refusal in the interface’s own voice', async () => {
    vi.mocked(requestUpload).mockResolvedValueOnce({ ok: false, error: 'BOARD_FULL' });
    render(<CardAttachments {...props} attachments={[]} />);
    await userEvent.upload(screen.getByLabelText(/add file/i), new File(['x'], 'a.png'));
    // Says what happened and what to do. Never apologises.
    expect(
      await screen.findByText(
        'This board has used its 1 GB of attachment storage. Delete a file to make room.',
      ),
    ).toBeInTheDocument();
  });

  test('shows progress while the bytes are in flight', async () => {
    render(<CardAttachments {...props} attachments={[]} />);
    await userEvent.upload(screen.getByLabelText(/add file/i), new File(['x'], 'a.png'));
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    // Let the upload settle before the test ends — otherwise its FakeXHR
    // timer fires during a later test and steals that test's mock call.
    await waitFor(() => expect(confirmUpload).toHaveBeenCalled());
  });

  test('calls confirmUpload once the PUT has finished', async () => {
    render(<CardAttachments {...props} attachments={[]} />);
    await userEvent.upload(screen.getByLabelText(/add file/i), new File(['x'], 'a.png'));
    await waitFor(() =>
      expect(confirmUpload).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentId: 'new-id' }),
      ),
    );
  });

  test('does not add the file to the list when confirm rejects it', async () => {
    // A file the server refused at confirm was deleted from the bucket.
    // Showing it would promise something that is not there.
    vi.mocked(confirmUpload).mockResolvedValueOnce({ ok: false, error: 'TOO_LARGE' });
    render(<CardAttachments {...props} attachments={[]} />);
    await userEvent.upload(screen.getByLabelText(/add file/i), new File(['x'], 'a.png'));
    await waitFor(() => expect(screen.getByText(/larger than/i)).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'a.png' })).not.toBeInTheDocument();
  });

  test('the uploader sees a delete control on their own file', async () => {
    render(
      <CardAttachments
        {...props}
        viewerId="u1"
        attachments={[file({ uploader: { id: 'u1', name: 'Alex', image: null } })]}
      />,
    );
    expect(screen.getByRole('button', { name: /delete screenshot\.png/i })).toBeInTheDocument();
  });

  test('a plain member sees no delete control on somebody else’s file', async () => {
    render(<CardAttachments {...props} viewerId="u2" viewerIsOwner={false} attachments={[file()]} />);
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  test('the board owner sees a delete control on anybody’s file', async () => {
    render(<CardAttachments {...props} viewerId="u2" viewerIsOwner attachments={[file()]} />);
    expect(screen.getByRole('button', { name: /delete screenshot\.png/i })).toBeInTheDocument();
  });

  test('the board owner sees a delete control on a file whose uploader is gone', async () => {
    render(
      <CardAttachments {...props} viewerId="u2" viewerIsOwner attachments={[file({ uploader: null })]} />,
    );
    expect(screen.getByRole('button', { name: /delete screenshot\.png/i })).toBeInTheDocument();
  });

  test('a demoted uploader sees no delete control on their own file', async () => {
    // deleteAttachment requires role >= member even for one's own file — only
    // the owner branch is unconditional. A viewer who once uploaded this file
    // would always get FORBIDDEN, so the control must not render for them.
    render(
      <CardAttachments
        {...props}
        canWrite={false}
        viewerId="u1"
        viewerIsOwner={false}
        attachments={[file({ uploader: { id: 'u1', name: 'Alex', image: null } })]}
      />,
    );
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
