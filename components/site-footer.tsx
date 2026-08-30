import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-line px-8 py-6">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 text-xs text-muted">
        <span>Work Planner</span>
        <Link href="/privacy" className="rounded-[var(--radius-control)] hover:text-ink">
          Privacy
        </Link>
      </div>
    </footer>
  );
}
