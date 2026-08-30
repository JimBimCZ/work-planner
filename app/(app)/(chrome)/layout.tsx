import { SiteFooter } from '@/components/site-footer';

// Everything under (app) except the board view: the page scrolls normally and
// the footer sits below it. The min-height frame is the (app) layout's — a
// second one here would stack with it and push a scrollbar onto short pages.
export default function ChromeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
