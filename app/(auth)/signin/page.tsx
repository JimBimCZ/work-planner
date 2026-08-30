import { supportedProvider } from '@/lib/account-conflict';
import { signIn } from '@/lib/auth';
import { safeCallbackUrl } from '@/lib/safe-redirect';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    provider?: string;
    attempted?: string;
    callbackUrl?: string;
  }>;
}) {
  const { error, provider, attempted, callbackUrl } = await searchParams;
  const target = safeCallbackUrl(callbackUrl);
  const owner = supportedProvider(provider);
  const retry = error === 'account-exists' && owner ? supportedProvider(attempted) : null;

  const message =
    error === 'account-exists' && owner
      ? `That email already signs in with ${owner.label}. Continue with ${owner.label} instead.`
      : error
        ? 'Something went wrong signing you in. Try again.'
        : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-8">
      <h1 className="text-[22px] font-medium tracking-[-0.01em]">Work Planner</h1>

      {message ? (
        <p role="status" className="text-[15px]/6 text-muted">
          {message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: target });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-[8px] border border-line bg-surface px-4 py-2.5 text-[15px] font-medium"
          >
            Continue with Google
          </button>
        </form>

        <form
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: target });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-[8px] border border-line bg-surface px-4 py-2.5 text-[15px] font-medium"
          >
            Continue with GitHub
          </button>
        </form>

        {retry ? (
          <form
            action={async () => {
              'use server';
              await signIn(retry.id, { redirectTo: target }, { prompt: 'select_account' });
            }}
          >
            <button type="submit" className="w-full px-4 py-1 text-[15px] text-muted underline">
              Use a different {retry.label} account
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
