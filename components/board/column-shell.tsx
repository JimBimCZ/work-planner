import { flowColor } from '@/lib/flow';

// Columns sit flush so the 3px rules meet edge to edge and read as one band
// across the board; the 12px gutter is inset padding instead, which keeps the
// card width at 300px without breaking the spectrum.
export function ColumnShell({
  name,
  hue,
  nextHue,
}: {
  name: string;
  hue: number;
  nextHue: number;
}) {
  return (
    <section className="flex h-full w-[312px] shrink-0 flex-col">
      <div
        className="h-[3px] shrink-0"
        style={{ background: `linear-gradient(90deg, ${flowColor(hue)}, ${flowColor(nextHue)})` }}
      />
      <div
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4"
        style={{ background: `linear-gradient(${flowColor(hue, 0.06)}, transparent 80px)` }}
      >
        <h2
          data-testid="column-name"
          className="px-1.5 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted"
        >
          {name}
        </h2>
        <p className="px-1.5 pt-6 text-sm text-muted">Nothing here yet</p>
      </div>
    </section>
  );
}
