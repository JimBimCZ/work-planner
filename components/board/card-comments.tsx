'use client';

import { useEffect, useState, useTransition } from 'react';

import { useRealtime } from '@/components/board/realtime';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { attempt } from '@/lib/attempt';
import { addComment, deleteComment, editComment, readComments } from '@/lib/actions/comments';
import type { CardComment, Viewer } from '@/lib/cards';
import { reinsertOrdered } from '@/lib/comment-order';
import { formatAbsolute, formatRelative } from '@/lib/relative-time';
import { useMounted } from '@/lib/use-mounted';

type Row = CardComment & { pending?: boolean };

function CommentTime({ at }: { at: Date }) {
  // Both the relative label and the tooltip read the viewer's clock, locale and
  // time zone, none of which the server knows — the hydration trap DueDate
  // already avoids in board-card.tsx. The element and its machine-readable
  // instant are identical on both renders; only what a person reads waits.
  // now is derived rather than stored, so a thread left open past the hour
  // re-reads the clock on its next render instead of freezing at mount.
  const mounted = useMounted();

  return (
    <time
      data-testid="comment-time"
      dateTime={at.toISOString()}
      title={mounted ? formatAbsolute(at) : undefined}
      className="font-mono"
    >
      {mounted ? formatRelative(at, new Date()) : null}
    </time>
  );
}

function commentLabel(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

export function CardComments({
  cardId,
  comments,
  viewer,
}: {
  cardId: string;
  comments: CardComment[];
  viewer: Viewer;
}) {
  const { claim, subscribe } = useRealtime();
  const [rows, setRows] = useState<Row[]>(comments);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Ordering is lib/comment-order.ts's job, not this component's: a remote
  // comment must land where its (createdAt, id) says, not simply at the end,
  // because an optimistic row of ours may already be sitting there.
  useEffect(
    () =>
      subscribe((event) => {
        if (!('cardId' in event) || event.cardId !== cardId) return;

        switch (event.type) {
          case 'comment.created':
            // reinsertOrdered compares createdAt as a Date; the event carries
            // an ISO string, so it is converted here rather than inside the
            // helper, which stays a pure ordering function.
            setRows((rows) =>
              reinsertOrdered(rows, {
                id: event.id,
                body: event.body,
                createdAt: new Date(event.createdAt),
                author: event.author,
              }),
            );
            return;
          case 'comment.created.truncated':
            void attempt(() => readComments({ cardId })).then((result) => {
              if (!result.ok) return;
              // A comment of ours still in flight is not in the server's
              // answer yet, and dropping it here would make it disappear
              // until a reload.
              setRows((rows) => [...result.data, ...rows.filter((row) => row.pending)]);
            });
            return;
          case 'comment.updated':
            // Only the stored body moves. An open editor holds its text in
            // editDraft, which nothing here touches, so a remote edit of the
            // comment you are editing cannot take the sentence off your screen.
            setRows((rows) =>
              rows.map((row) => (row.id === event.id ? { ...row, body: event.body } : row)),
            );
            return;
          case 'comment.deleted':
            setRows((rows) => rows.filter((row) => row.id !== event.id));
            return;
          default:
            return;
        }
      }),
    [subscribe, cardId],
  );

  const submit = () => {
    const body = draft.trim();
    if (!body) return;

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Row = {
      id: tempId,
      body,
      createdAt: new Date(),
      author: { id: viewer.id, name: viewer.name, image: null },
      pending: true,
    };

    setRows((current) => [...current, optimistic]);
    setDraft('');
    setError(null);

    startTransition(async () => {
      const result = await attempt(() => addComment({ cardId, body, mutationId: claim() }));
      if (result.ok) {
        setRows((current) =>
          // A truncated-comment refetch can land between this post and its
          // response and already carry our comment under its real id. Renaming
          // the temp row then would leave two rows sharing one key.
          current.some((row) => row.id === result.data.id)
            ? current.filter((row) => row.id !== tempId)
            : current.map((row) =>
                row.id === tempId ? { ...row, id: result.data.id, pending: false } : row,
              ),
        );
      } else {
        setRows((current) => current.filter((row) => row.id !== tempId));
        // Only restore the failed text if the box is still empty — a faster
        // draft typed while this request was in flight must not be clobbered.
        setDraft((current) => (current === '' ? body : current));
        setError('That comment could not be added. Try again.');
      }
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };

  const saveEdit = (row: Row) => {
    const body = editDraft.trim();
    if (!body || body === row.body) {
      setEditingId(null);
      return;
    }
    const previous = row.body;
    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, body } : r)));
    setEditingId(null);
    setError(null);

    startTransition(async () => {
      const result = await attempt(() =>
        editComment({
          commentId: row.id,
          body,
          mutationId: claim(),
        }),
      );
      if (!result.ok) {
        // Only roll back if the row still holds the value this request sent —
        // a later edit to the same comment that already succeeded must not be
        // clobbered by this save's own rejection landing late.
        setRows((current) =>
          current.map((r) => (r.id === row.id && r.body === body ? { ...r, body: previous } : r)),
        );
        setError('That comment could not be saved. Try again.');
      }
    });
  };

  const remove = (row: Row) => {
    setRows((current) => current.filter((r) => r.id !== row.id));
    setError(null);

    startTransition(async () => {
      const result = await attempt(() =>
        deleteComment({ commentId: row.id, mutationId: claim() }),
      );
      if (!result.ok) {
        setRows((current) => reinsertOrdered(current, row));
        setError('That comment could not be deleted. Try again.');
      }
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Comments</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No comments yet</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className={row.pending ? 'opacity-60' : ''}>
              <p className="flex items-baseline gap-2 text-xs text-muted">
                <span>
                  {row.author === null ? 'Deleted account' : (row.author.name ?? 'Someone')}
                </span>
                <CommentTime at={row.createdAt} />
              </p>
              <p data-testid="comment-body" className="whitespace-pre-wrap text-sm text-ink">
                {row.body}
              </p>
              {row.author?.id === viewer.id && !row.pending ? (
                editingId === row.id ? (
                  <div className="mt-1 flex flex-col gap-2">
                    <textarea
                      aria-label={`Edit comment: ${commentLabel(row.body)}`}
                      rows={3}
                      value={editDraft}
                      maxLength={4000}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') cancelEdit();
                      }}
                      className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => saveEdit(row)}
                        className="self-start rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
                      >
                        Save changes
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="text-xs text-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 flex gap-3">
                    <button
                      type="button"
                      aria-label={`Edit comment: ${commentLabel(row.body)}`}
                      onClick={() => {
                        setEditingId(row.id);
                        setEditDraft(row.body);
                      }}
                      className="text-xs text-muted hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete comment: ${commentLabel(row.body)}`}
                      onClick={() => setConfirmDeleteId(row.id)}
                      className="text-xs text-muted hover:text-time-over"
                    >
                      Delete
                    </button>
                  </div>
                )
              ) : null}

              <Dialog
                open={confirmDeleteId === row.id}
                onOpenChange={(next) => (next ? undefined : setConfirmDeleteId(null))}
              >
                <DialogContent>
                  <DialogTitle>Delete comment</DialogTitle>
                  <p className="mt-2 text-sm text-muted">
                    This removes the comment. It cannot be undone.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      remove(row);
                      setConfirmDeleteId(null);
                    }}
                    className="mt-4 rounded-[var(--radius-control)] bg-time-over px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Delete comment
                  </button>
                </DialogContent>
              </Dialog>
            </li>
          ))}
        </ul>
      )}

      {/* Unconditional: both pages already notFound() anyone below viewer,
          so reaching this component at all is the right to comment. */}
      <div className="flex flex-col gap-2">
        <textarea
          aria-label="Add a comment"
          rows={3}
          value={draft}
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
          className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
        <button
          type="button"
          onClick={submit}
          disabled={draft.trim() === ''}
          className="self-start rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Comment
        </button>
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-xs text-time-over">
        {error}
      </p>
    </section>
  );
}
