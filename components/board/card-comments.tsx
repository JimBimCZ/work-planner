'use client';

import { useState, useTransition } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { addComment, deleteComment, editComment } from '@/lib/actions/comments';
import type { CardComment, Viewer } from '@/lib/cards';
import { reinsertOrdered } from '@/lib/comment-order';

type Row = CardComment & { pending?: boolean };

export function CardComments({
  cardId,
  comments,
  viewer,
}: {
  cardId: string;
  comments: CardComment[];
  viewer: Viewer;
}) {
  const [rows, setRows] = useState<Row[]>(comments);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
      const result = await addComment({ cardId, body });
      if (result.ok) {
        setRows((current) =>
          current.map((row) =>
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
      const result = await editComment({ commentId: row.id, body });
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
      const result = await deleteComment({ commentId: row.id });
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
              <p className="font-mono text-xs text-muted">
                {row.author === null ? 'Deleted account' : (row.author.name ?? 'Someone')}
              </p>
              <p data-testid="comment-body" className="whitespace-pre-wrap text-sm text-ink">
                {row.body}
              </p>
              {row.author?.id === viewer.id && !row.pending ? (
                editingId === row.id ? (
                  <div className="mt-1 flex flex-col gap-2">
                    <textarea
                      aria-label="Edit comment"
                      rows={3}
                      value={editDraft}
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
                      aria-label="Edit comment"
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
                      aria-label="Delete comment"
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
