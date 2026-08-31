'use client';

import { useState, useTransition } from 'react';

import { addComment } from '@/lib/actions/comments';
import type { CardComment } from '@/lib/cards';

type Row = CardComment & { pending?: boolean };

export function CardComments({
  cardId,
  comments,
  viewer,
}: {
  cardId: string;
  comments: CardComment[];
  viewer: { id: string; name: string | null; image: string | null };
}) {
  const [rows, setRows] = useState<Row[]>(comments);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const submit = () => {
    const body = draft.trim();
    if (!body) return;

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Row = {
      id: tempId,
      body,
      createdAt: new Date(),
      author: { id: viewer.id, name: viewer.name, image: viewer.image },
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
        setDraft(body);
        setError('That comment could not be added. Try again.');
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
