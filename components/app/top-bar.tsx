import { AccountMenu } from '@/components/app/account-menu';

// A page cannot pass data up into a layout, so the board title is resolved in
// the layout on the dynamic segment and handed down here.
export function TopBar({
  userId,
  name,
  email,
  image,
  title,
  actions,
}: {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  title?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-line bg-surface px-4 py-2.5">
      {title ? (
        <h1 className="text-[15px] font-medium tracking-[-0.01em]">{title}</h1>
      ) : (
        <span className="text-[15px] font-medium">Work Planner</span>
      )}
      <div className="flex items-center gap-3">
        {actions}
        <AccountMenu userId={userId} name={name} email={email} image={image} />
      </div>
    </header>
  );
}
