'use client';

import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

// The pre-paint script in the root layout owns data-theme, so the attribute is
// the source of truth and React subscribes to it rather than mirroring it into
// state. Reading it in an effect instead would trip react-hooks/set-state-in-effect.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function getServerSnapshot(): Theme {
  return 'light';
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm font-medium"
    >
      {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
    </button>
  );
}
