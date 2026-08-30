import { flowHue } from '@/lib/flow';
import { ThemeToggle } from './theme-toggle';

const TOKENS = [
  ['canvas', 'board background'],
  ['surface', 'cards, modal, top bar'],
  ['ink', 'primary text'],
  ['muted', 'secondary text'],
  ['line', 'borders, dividers'],
  ['flow-1', 'first column'],
  ['flow-mid', 'accent'],
  ['flow-last', 'last column'],
  ['time-soon', 'due soon'],
  ['time-over', 'overdue'],
] as const;

function Spectrum({ total }: { total: number }) {
  return (
    <div data-testid={`spectrum-${total}`} className="flex gap-3">
      {Array.from({ length: total }, (_, index) => {
        const hue = flowHue(index, total);
        const next = flowHue(Math.min(index + 1, total - 1), total);
        return (
          <div key={index} className="flex-1" data-hue={hue}>
            <div
              className="h-[3px] w-full"
              style={{
                background: `linear-gradient(90deg, hsl(${hue} 60% 45%), hsl(${next} 60% 45%))`,
              }}
            />
            <div
              className="h-20 px-2 pt-2 text-xs font-semibold uppercase tracking-[0.08em]"
              style={{
                background: `linear-gradient(hsl(${hue} 60% 45% / 0.06), transparent 80px)`,
              }}
            >
              Column {index + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DesignPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-[22px] font-medium">Design tokens</h1>
        <ThemeToggle />
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Colour</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {TOKENS.map(([name, role]) => (
            <div key={name} data-testid={`swatch-${name}`} className="flex flex-col gap-1">
              <div
                className="h-14 rounded-[var(--radius-card)] border border-line"
                style={{ background: `var(--${name})` }}
              />
              <span className="font-mono text-xs">--{name}</span>
              <span className="text-xs text-muted">{role}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Flow spectrum</h2>
        <Spectrum total={3} />
        <Spectrum total={5} />
        <Spectrum total={8} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Type</h2>
        <p className="text-[22px] font-medium">Board title, 22 display</p>
        <p className="text-[15px]/6">Body copy at 15 on 24. Active voice, sentence case, no filler.</p>
        <p className="text-sm/5 font-medium">Card title, 14 on 20, weight 500</p>
        <p className="font-mono text-xs">card meta 12 mono &middot; 3d over</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Surfaces</h2>
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-64 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-sm">
            <p className="text-sm/5 font-medium">A card at radius 10</p>
            <p className="mt-2 font-mono text-xs text-muted">12 mono meta</p>
          </div>
          <div className="w-64 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-sm">
            <div className="h-[2px] w-full bg-time-over" />
            <div className="p-3">
              <p className="text-sm/5 font-medium">An overdue card</p>
              <p className="mt-2 font-mono text-xs text-time-over">3d over</p>
            </div>
          </div>
          <div className="w-64 rounded-[var(--radius-modal)] border border-line bg-surface p-4 shadow-lg">
            <p className="text-sm/5 font-medium">A modal at radius 16</p>
            <p className="mt-2 text-[15px]/6 text-muted">Body copy inside a modal.</p>
          </div>
          <button
            type="button"
            className="rounded-[var(--radius-control)] bg-flow-mid px-3 py-1.5 text-sm font-medium text-white"
          >
            Add card
          </button>
        </div>
      </section>
    </main>
  );
}
