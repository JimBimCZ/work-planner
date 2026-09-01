import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Privacy Policy — Work Planner',
  description: 'What Work Planner collects, why, and what you can ask us to do about it.',
};

const LAST_UPDATED = '1 September 2026';

const CONTROLLER = 'Vit Busek';
const CONTACT_EMAIL = 'busek.vit@gmail.com';

const PROCESSORS = [
  ['Vercel', 'Hosting and serverless functions', 'EU — Frankfurt (fra1)'],
  ['Neon', 'Postgres database', 'EU — Frankfurt (eu-central-1)'],
  ['Pusher', 'Realtime board updates', 'EU'],
  ['Google', 'Sign-in, if you choose it', 'Per Google’s own policy'],
  ['GitHub', 'Sign-in, if you choose it', 'Per GitHub’s own policy'],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-10 px-8 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-[22px] font-medium tracking-[-0.01em]">Privacy Policy</h1>
        <p className="font-mono text-xs text-muted">Last updated {LAST_UPDATED}</p>
      </header>

      <p className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-[15px]/6">
        This policy has not been reviewed by a lawyer. It names a real controller and describes
        what the application actually does today, but treat it as a working draft until it has had
        a legal read.
      </p>

      <Section title="Who runs Work Planner">
        <p className="text-[15px]/6">
          Work Planner is operated by <span className="font-mono text-sm">{CONTROLLER}</span>, the
          controller of the personal data described here. For anything in this policy, including any
          of the requests under “Your rights”, write to{' '}
          <span className="font-mono text-sm">{CONTACT_EMAIL}</span>.
        </p>
      </Section>

      <Section title="What we collect">
        <p className="text-[15px]/6">Four things, and nothing beyond them:</p>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px]/6">
          <li>
            <strong className="font-medium">Your profile from Google or GitHub</strong> — name,
            email address, avatar URL, and the account identifier your provider uses. We receive
            this when you sign in. We never see your password.
          </li>
          <li>
            <strong className="font-medium">What you create</strong> — boards, columns, cards,
            descriptions, due dates, and comments, along with who made them and when.
          </li>
          <li>
            <strong className="font-medium">A session cookie</strong> — so the app knows you are
            still signed in between page loads.
          </li>
          <li>
            <strong className="font-medium">Invitations</strong> — if you invite somebody to a
            board, we store the email address you type. We delete it when the invitation is
            accepted, declined or withdrawn. An invitation expires 30 days after it is sent and
            can no longer be accepted, but an expired invitation nobody withdraws stays in the
            database until that address is invited to that board again. If you delete your
            account, invitations addressed to you go with it.
          </li>
        </ul>
        <p className="text-[15px]/6">
          There is no analytics, no advertising, no profiling, and no third-party tracking script.
        </p>
      </Section>

      <Section title="Why we collect it, and the legal basis">
        <p className="text-[15px]/6">
          Your profile and your board content are processed to give you the account and the boards
          you asked for — the legal basis is performance of a contract. Keeping sign-in sessions
          secure and preventing abuse rests on our legitimate interest in running the service
          safely. We do not use any of it for marketing.
        </p>
      </Section>

      <Section title="Cookies">
        <p className="text-[15px]/6">
          Only the sign-in session cookie and the CSRF and callback cookies the authentication
          library needs. All of them are strictly necessary to sign you in, so there is no consent
          banner. If analytics, session replay, or any other third-party script is ever added, this
          section changes and a consent mechanism becomes necessary first.
        </p>
      </Section>

      <Section title="Who else processes your data">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[15px]/6">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.08em] text-muted">
                <th className="py-2 pr-4 font-semibold">Who</th>
                <th className="py-2 pr-4 font-semibold">What for</th>
                <th className="py-2 font-semibold">Where</th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map(([name, purpose, region]) => (
                <tr key={name} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4">{name}</td>
                  <td className="py-2 pr-4 text-muted">{purpose}</td>
                  <td className="py-2 font-mono text-xs">{region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[15px]/6 text-muted">
          Your board data stays in Frankfurt: the database is pinned to eu-central-1 and the
          functions that read and write it are pinned to fra1. Realtime updates go through
          Pusher’s EU cluster. Vercel’s CDN serves static pages from whichever location is nearest
          you, so a request made from outside the EU is logged at a point of presence outside it —
          that log holds an IP address and a URL, never board content.
        </p>
      </Section>

      <Section title="Who can see your boards">
        <p className="text-[15px]/6">
          Anything you write on a shared board — card titles, descriptions, due dates, comments, and
          your name and avatar — is visible to every other member of that board. Treat a shared
          board as visible to the people you shared it with, and do not put anything on one that you
          would not want them to read.
        </p>
      </Section>

      <Section title="Keeping and deleting your data">
        <p className="text-[15px]/6">
          Your account and board content are kept for as long as your account exists. You can delete
          your account yourself from the account page: it removes your sign-in, your sessions, the
          boards you own and everything on them, immediately and permanently. Boards owned by other
          people keep the comments you left on them, without your name attached — if you want those
          removed as well, email{' '}
          <span className="font-mono text-sm">{CONTACT_EMAIL}</span> before you delete your account,
          because afterwards nothing links them to you.
        </p>
      </Section>

      <Section title="Your rights">
        <p className="text-[15px]/6">
          Under the GDPR you can ask for a copy of your data, correct it, have it deleted, receive
          it in a portable format, or object to how it is processed. Write to{' '}
          <span className="font-mono text-sm">{CONTACT_EMAIL}</span> and we will respond within one
          month.
        </p>
        <p className="text-[15px]/6">
          If you think we have handled your data badly, you can complain to the Czech supervisory
          authority, Úřad pro ochranu osobních údajů (uoou.gov.cz).
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p className="text-[15px]/6">
          When this policy changes, the date at the top changes with it. If a change materially
          affects how your data is handled, we will tell you by email before it takes effect.
        </p>
      </Section>

      <Link href="/" className="text-[15px]/6 text-flow-mid hover:underline">
        Back to Work Planner
      </Link>
    </main>
  );
}
