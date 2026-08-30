import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import PrivacyPage, { metadata } from './page';

const html = () => renderToStaticMarkup(<PrivacyPage />);

describe('privacy policy', () => {
  // CLAUDE.md enumerates what the policy must cover. These assertions are the
  // guard against the page drifting back into filler.
  test.each([
    ['controller and contact', /who runs work planner/i],
    ['what is collected', /what we collect/i],
    ['legal basis', /legal basis/i],
    ['cookies', /cookies/i],
    ['sub-processors', /who else processes/i],
    ['content visibility', /who can see your boards/i],
    ['retention and deletion', /keeping and deleting/i],
    ['GDPR rights', /your rights/i],
    ['changes to the policy', /changes to this policy/i],
  ])('covers %s', (_label, pattern) => {
    expect(html()).toMatch(pattern);
  });

  test('names every sub-processor the app actually uses', () => {
    const markup = html();
    for (const processor of ['Vercel', 'Neon', 'Pusher', 'Google', 'GitHub']) {
      expect(markup).toContain(processor);
    }
  });

  test('does not name Neon Auth, which the project removed', () => {
    expect(html()).not.toMatch(/neon auth/i);
  });

  test('names the supervisory authority for a Czech controller', () => {
    expect(html()).toMatch(/Úřad pro ochranu osobních údajů/);
  });

  test('carries a last-updated date', () => {
    expect(html()).toMatch(/Last updated/i);
  });

  test('is statically rendered and titled', () => {
    expect(metadata.title).toBeTruthy();
  });
});
