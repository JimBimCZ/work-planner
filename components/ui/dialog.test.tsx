// @vitest-environment jsdom
// vitest.config.mts registers no setupFiles, so the matchers below
// (toHaveClass, toBeInTheDocument, toHaveTextContent) come from here or not
// at all. components/board/card-comments.test.tsx:2 is the convention.
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

afterEach(cleanup);

it('merges overlayClassName onto the overlay', () => {
  render(
    <Dialog open>
      <DialogContent overlayClassName="bg-transparent">
        <DialogTitle>Hello</DialogTitle>
      </DialogContent>
    </Dialog>,
  );

  const overlay = document.querySelector('[data-slot="dialog-overlay"]');
  expect(overlay).toHaveClass('bg-transparent');
  // tailwind-merge drops the default it replaces rather than stacking both.
  expect(overlay).not.toHaveClass('bg-canvas/70');
});

it('still paints the default scrim when the prop is absent', () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Hello</DialogTitle>
      </DialogContent>
    </Dialog>,
  );

  expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass('bg-canvas/70');
});
