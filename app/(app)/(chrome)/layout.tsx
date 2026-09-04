import { redirect } from 'next/navigation';
import { TopBar } from '@/components/app/top-bar';
import { SiteFooter } from '@/components/site-footer';
import { auth } from '@/lib/auth';

// Everything under (app) except the board view: the page scrolls normally and
// the footer sits below it.
export default async function ChromeLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/signin');

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        viewer={{
          userId: session.user.id ?? '',
          name: session.user.name ?? null,
          email: session.user.email ?? '',
          image: session.user.image ?? null,
        }}
      />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
