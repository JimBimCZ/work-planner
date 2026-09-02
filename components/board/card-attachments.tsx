'use client';

import type { CardAttachment } from '@/lib/attachments';
import { STORAGE_PER_BOARD, rendersInline } from '@/lib/attachments-limits';

// Mono, because CLAUDE.md gives data its own family: sizes, dates and counts.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const USAGE_WARNING_RATIO = 0.8;

export function CardAttachments({
  attachments,
  canWrite,
  storageEnabled,
  boardUsed,
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
  // No bucket and nothing to show: the section does not exist rather than
  // presenting an empty state for a feature this deployment does not have.
  if (!storageEnabled && attachments.length === 0) return null;

  const nearCap = boardUsed >= STORAGE_PER_BOARD * USAGE_WARNING_RATIO;

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Attachments</h3>

      {attachments.length === 0 ? (
        <p className="text-sm text-muted">Nothing attached yet</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {attachments.map((file) => (
            <li key={file.id}>
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
            </li>
          ))}
        </ul>
      )}

      {canWrite && storageEnabled && nearCap ? (
        <p className="mt-2 font-mono text-xs text-muted">
          {formatSize(boardUsed)} of 1 GB used
        </p>
      ) : null}
    </section>
  );
}
