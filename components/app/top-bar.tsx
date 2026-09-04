import { AccountMenu } from '@/components/app/account-menu';

export type TopBarViewer = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
};

// A page cannot pass data up into a layout, so the board title is resolved in
// the layout on the dynamic segment and handed down here.
export function TopBar({
  viewer,
  title,
  nav,
  actions,
}: {
  // Absent on the demo board at /, which is served to someone with no
  // session. Every other surface under (app) has one by the time it renders.
  viewer?: TopBarViewer;
  title?: string;
  // Navigation, not an action: it sits to the left of the title so the bar
  // reads as "Boards / this board" rather than burying the way out among the
  // things you do to the board you are on.
  nav?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        {nav}
        {title ? (
          <h1 className="truncate text-[15px] font-medium tracking-[-0.01em]">{title}</h1>
        ) : (
          <span className="text-[15px] font-medium">Work Planner</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {actions}
        {viewer ? (
          <AccountMenu
            userId={viewer.userId}
            name={viewer.name}
            email={viewer.email}
            image={viewer.image}
          />
        ) : null}
      </div>
    </header>
  );
}
