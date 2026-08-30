export function AccountMenu({
  email,
}: {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
}) {
  return <span className="text-xs text-muted">{email}</span>;
}
