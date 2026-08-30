import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { SiteFooter } from './site-footer';

describe('SiteFooter', () => {
  test('links to the privacy policy', () => {
    expect(renderToStaticMarkup(<SiteFooter />)).toContain('href="/privacy"');
  });

  test('ships no client JS', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('components/site-footer.tsx', 'utf8'),
    );
    expect(source).not.toContain("'use client'");
  });
});
