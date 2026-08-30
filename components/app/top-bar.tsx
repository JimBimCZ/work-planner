import { AccountMenu } from '@/components/app/account-menu';

// Deliberately thin: sub-project 4 adds the board title and "New card" here
// rather than introducing a second header.
export function TopBar({
  userId,
  name,
  email,
  image,
}: {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
}) {
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
      <span className="text-[15px] font-medium">Work Planner</span>
      <AccountMenu userId={userId} name={name} email={email} image={image} />
    </header>
  );
}
