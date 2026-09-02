'use client';

import { useId, useState } from 'react';

import { confirmUpload, deleteAttachment, requestUpload } from '@/lib/actions/attachments';
import type { CardAttachment } from '@/lib/attachments';
import { ATTACHMENT_SIZE_MAX, STORAGE_PER_BOARD, rendersInline } from '@/lib/attachments-limits';
import { attempt } from '@/lib/attempt';

// Mono, because CLAUDE.md gives data its own family: sizes, dates and counts.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const USAGE_WARNING_RATIO = 0.8;

const REFUSALS: Record<string, string> = {
  BOARD_FULL: 'This board has used its 1 GB of attachment storage. Delete a file to make room.',
  ACCOUNT_FULL: 'You have used your 2 GB of attachment storage. Delete a file to make room.',
  TOO_MANY: 'This card already has ten files. Delete one to add another.',
  TOO_LARGE: 'That file is larger than the 10 MB limit.',
  UNAVAILABLE: 'Attachment storage is not set up for this deployment.',
  FORBIDDEN: 'You do not have permission to attach files to this board.',
  NOT_FOUND: 'That card no longer exists.',
  INVALID: 'That file could not be attached. Check the name and try again.',
  UNAUTHENTICATED: 'Sign in again to attach a file.',
  // Neither the request/confirm actions nor a dropped connection: see lib/attempt.ts.
  UNREACHABLE: 'Could not reach the server. Try again.',
};
// Any code the actions module adds later still reads in the same voice
// instead of printing a raw error constant.
const DEFAULT_REFUSAL = 'That file could not be attached. Try again.';
// One message, not the REFUSALS table: NOT_FOUND there reads "That card no
// longer exists", which is wrong for a file.
const DELETE_REFUSAL = 'That file could not be deleted. Try again.';

function refusal(error: string): string {
  return REFUSALS[error] ?? DEFAULT_REFUSAL;
}

function put(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  // XMLHttpRequest, not fetch: fetch reports no upload progress, and 10 MB on
  // a slow connection needs a bar rather than a frozen dialog.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed: ${xhr.status}`)),
    );
    xhr.addEventListener('error', () => reject(new Error('upload failed')));
    xhr.send(file);
  });
}

type PendingUpload = { filename: string; progress: number };

export function CardAttachments({
  cardId,
  attachments,
  canWrite,
  viewerId,
  viewerIsOwner,
  storageEnabled,
  boardUsed,
  onChange,
}: {
  cardId: string;
  attachments: CardAttachment[];
  canWrite: boolean;
  viewerId: string;
  viewerIsOwner: boolean;
  storageEnabled: boolean;
  boardUsed: number;
  onChange: (next: CardAttachment[]) => void;
}) {
  const fileInputId = useId();
  const [pending, setPending] = useState<Record<string, PendingUpload>>({});
  const [error, setError] = useState<string | null>(null);

  // No bucket and nothing to show: the section does not exist rather than
  // presenting an empty state for a feature this deployment does not have.
  if (!storageEnabled && attachments.length === 0) return null;

  const nearCap = boardUsed >= STORAGE_PER_BOARD * USAGE_WARNING_RATIO;

  const dropPending = (mutationId: string) =>
    setPending((current) => {
      const next = { ...current };
      delete next[mutationId];
      return next;
    });

  const uploadFile = async (file: File) => {
    setError(null);

    if (file.size > ATTACHMENT_SIZE_MAX) {
      setError(refusal('TOO_LARGE'));
      return;
    }

    // Generated here rather than via useRealtime().claim(): this component
    // also renders standalone in tests, outside a RealtimeProvider.
    const mutationId = crypto.randomUUID();
    setPending((current) => ({ ...current, [mutationId]: { filename: file.name, progress: 0 } }));

    const requested = await attempt(() =>
      requestUpload({
        cardId,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        mutationId,
      }),
    );
    if (!requested.ok) {
      setError(refusal(requested.error));
      dropPending(mutationId);
      return;
    }

    try {
      await put(requested.data.url, file, (fraction) => {
        setPending((current) =>
          current[mutationId]
            ? { ...current, [mutationId]: { ...current[mutationId], progress: fraction } }
            : current,
        );
      });
    } catch {
      setError(DEFAULT_REFUSAL);
      dropPending(mutationId);
      return;
    }

    const confirmed = await attempt(() =>
      confirmUpload({ attachmentId: requested.data.attachmentId, mutationId }),
    );
    dropPending(mutationId);
    if (!confirmed.ok) {
      setError(refusal(confirmed.error));
      return;
    }

    // The declared name/type/size, not what headObject actually read back —
    // that reconciliation happens on the next load and, later, over Pusher.
    onChange([
      ...attachments,
      {
        id: confirmed.data.attachmentId,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        createdAt: new Date(),
        uploader: null,
      },
    ]);
  };

  const uploadFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => void uploadFile(file));
  };

  // Optimistic, in the same shape as CardBody's changeLabels: drop the row,
  // call the action, put it back and show the message if it fails.
  const deleteFile = (attachmentId: string) => {
    const previous = attachments;
    onChange(attachments.filter((file) => file.id !== attachmentId));
    setError(null);

    void attempt(() =>
      deleteAttachment({ attachmentId, mutationId: crypto.randomUUID() }),
    ).then((result) => {
      if (!result.ok) {
        onChange(previous);
        setError(DELETE_REFUSAL);
      }
    });
  };

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Attachments</h3>

      {attachments.length === 0 ? (
        <p className="text-sm text-muted">Nothing attached yet</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {attachments.map((file) => {
            // Mirrors the server's `mine || role === 'owner'` exactly: the
            // server also requires role >= member even for one's own file —
            // only the owner branch is unconditional — so "mine" here is
            // gated on canWrite too. Presentation only — deleteAttachment
            // re-checks regardless.
            const canDelete = (canWrite && file.uploader?.id === viewerId) || viewerIsOwner;
            return (
              <li key={file.id} className="flex items-start justify-between gap-2">
                <div>
                  {rendersInline(file.contentType) ? (
                    <a href={`/api/attachments/${file.id}`}>
                      {/* Not next/image: the bytes live behind an access-checked
                          redirect, so the optimiser cannot fetch them, and the
                          dimensions are unknown until the image loads. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/attachments/${file.id}`}
                        alt={file.filename}
                        className="max-h-64 rounded-[10px] border border-line"
                      />
                    </a>
                  ) : (
                    <a href={`/api/attachments/${file.id}`} className="text-sm text-ink underline">
                      {file.filename}
                    </a>
                  )}
                  <p className="font-mono text-xs text-muted">{formatSize(file.size)}</p>
                </div>
                {canDelete ? (
                  <button
                    type="button"
                    aria-label={`Delete ${file.filename}`}
                    onClick={() => deleteFile(file.id)}
                    className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-xs font-medium text-time-over hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow-mid focus-visible:ring-offset-2"
                  >
                    Delete
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && storageEnabled && nearCap ? (
        <p className="mt-2 font-mono text-xs text-muted">{formatSize(boardUsed)} of 1 GB used</p>
      ) : null}

      {canWrite && storageEnabled ? (
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            uploadFiles(event.dataTransfer.files);
          }}
          className="mt-3 flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-4 text-center text-xs text-muted"
        >
          <p>Drop a file here, or</p>
          <label
            htmlFor={fileInputId}
            className="cursor-pointer rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-flow-mid focus-within:outline-none focus-within:ring-2 focus-within:ring-flow-mid focus-within:ring-offset-2"
          >
            Add file
            <input
              id={fileInputId}
              type="file"
              className="sr-only"
              onChange={(event) => {
                uploadFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
        </div>
      ) : null}

      {Object.entries(pending).length > 0 ? (
        <ul className="mt-2 space-y-2">
          {Object.entries(pending).map(([mutationId, upload]) => (
            <li key={mutationId} className="text-xs text-muted">
              <p className="truncate">{upload.filename}</p>
              <progress
                value={upload.progress}
                max={1}
                aria-label={`Uploading ${upload.filename}`}
                className="h-1 w-full accent-flow-mid"
              />
            </li>
          ))}
        </ul>
      ) : null}

      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-time-over">
        {error}
      </p>
    </section>
  );
}
