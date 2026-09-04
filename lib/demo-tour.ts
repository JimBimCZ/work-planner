// The tour's script, and the only place it lives. Imports nothing, in the
// manner of lib/demo-board.ts and the *-limits.ts modules: this is read by a
// client component, and a value import that reached lib/db would put the pg
// pool in the browser bundle, which only `pnpm build` would notice.

export type TourStep = {
  id: string;
  title: string;
  body: string;
  // Absent on the opening step, which is centred and lights nothing:
  // anchoring "this board is real" to one card makes the visitor hunt before
  // they know what they are looking at.
  selector?: string;
};

// Steps 2 and 3 name cards in different columns deliberately — crossing the
// board is what exercises the scroll-into-view at every viewport, so the
// mechanism is proven by the content rather than by a contrived test.
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'A board you can poke at',
    body: 'Everything here works. Nothing is saved, so move what you like; a reload puts it all back.',
  },
  {
    id: 'open',
    title: 'Open a card',
    body: 'Click any card for its description, labels and comments. This one is three days overdue, which is why its date is warm.',
    selector: '[data-card-id="demo-card-migrate"]',
  },
  {
    id: 'drag',
    title: 'Drag it anywhere',
    body: 'Cards move between columns and reorder within one. Two people can drop in the same place without fighting over it.',
    selector: '[data-card-id="demo-card-drag"]',
  },
  {
    id: 'columns',
    title: 'Columns are yours',
    body: 'Rename, reorder, add or delete them. Colour follows position, so a card moves toward green as it gets closer to done.',
    selector: '[data-column-id="demo-col-done"]',
  },
  {
    id: 'signin',
    title: 'Sign in for a board of your own',
    body: 'Boards, teammates, files, comments, and a log of who did what. Google or GitHub, no password.',
    selector: '[data-tour="signin"]',
  },
];

// Filtered at open time, so the counter reports the steps a visitor will be
// shown rather than the steps that were written. A zero-size box counts as
// absent: an element can be in the DOM and have no geometry.
export function visibleSteps(
  steps: TourStep[],
  resolve: (selector: string) => DOMRect | null,
): TourStep[] {
  return steps.filter((step) => {
    if (!step.selector) return true;
    const rect = resolve(step.selector);
    return rect !== null && rect.width > 0 && rect.height > 0;
  });
}
