import { describe, expect, it } from 'vitest';

import { demoBoard } from '@/lib/demo-board';
import { TOUR_STEPS, visibleSteps, type TourStep } from '@/lib/demo-tour';

const fixture = demoBoard(new Date());
const cardIds = new Set(fixture.columns.flatMap((column) => column.cards.map((card) => card.id)));
const columnIds = new Set(fixture.columns.map((column) => column.id));

const box = (width = 100, height = 40) => ({ width, height }) as DOMRect;

describe('TOUR_STEPS', () => {
  it('opens with a step that lights nothing', () => {
    expect(TOUR_STEPS[0].selector).toBeUndefined();
    expect(TOUR_STEPS.slice(1).every((step) => step.selector)).toBe(true);
  });

  it('has unique ids', () => {
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length);
  });

  // A fixture edit that renames a card must fail here rather than degrade the
  // tour silently in front of a stranger.
  it('names only cards and columns the fixture actually has', () => {
    for (const step of TOUR_STEPS) {
      const card = step.selector?.match(/^\[data-card-id="([^"]+)"\]$/)?.[1];
      const column = step.selector?.match(/^\[data-column-id="([^"]+)"\]$/)?.[1];
      if (card) expect(cardIds).toContain(card);
      if (column) expect(columnIds).toContain(column);
    }
  });

  it('points at cards in two different columns', () => {
    const targeted = TOUR_STEPS.map((step) => step.selector?.match(/^\[data-card-id="([^"]+)"\]$/)?.[1]).filter(
      (id): id is string => Boolean(id),
    );
    const owning = targeted.map(
      (id) => fixture.columns.find((column) => column.cards.some((card) => card.id === id))?.id,
    );
    expect(new Set(owning).size).toBe(owning.length);
  });
});

describe('visibleSteps', () => {
  const steps: TourStep[] = [
    { id: 'a', title: 'A', body: 'a' },
    { id: 'b', title: 'B', body: 'b', selector: '#here' },
    { id: 'c', title: 'C', body: 'c', selector: '#gone' },
    { id: 'd', title: 'D', body: 'd', selector: '#flat' },
  ];
  const resolve = (selector: string) =>
    selector === '#here' ? box() : selector === '#flat' ? box(0, 0) : null;

  it('keeps a step with no selector', () => {
    expect(visibleSteps(steps, resolve).map((step) => step.id)).toContain('a');
  });

  it('drops a step whose element is absent or has no box', () => {
    expect(visibleSteps(steps, resolve).map((step) => step.id)).toEqual(['a', 'b']);
  });
});
