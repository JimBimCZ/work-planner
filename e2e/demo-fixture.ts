import { test as base } from '@playwright/test';

// The demo tour opens itself on a first visit, which is a modal over every
// element these specs click. Seeding its flag before the page script runs is
// how a demo test says "not today" — put here rather than in each file so the
// next demo spec inherits it instead of rediscovering the failure.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('demo-tour', 'seen');
      } catch {
        // Matches the component: a browser that refuses to remember still works.
      }
    });
    // Playwright's fixture `use`, not React's; the rule matches on the name.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- see above
    await use(page);
  },
});

export { expect } from '@playwright/test';
