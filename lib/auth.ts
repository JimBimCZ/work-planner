import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { conflictingProvider } from '@/lib/account-conflict';
import { db } from '@/lib/db';
import { accounts, users } from '@/lib/db/schema';

export const { handlers, auth, signIn, signOut } = NextAuth({
  // No schema argument: the adapter then builds every table it needs from its
  // own defaults, so verificationToken and authenticator never have to exist.
  adapter: DrizzleAdapter(db),
  session: { strategy: 'database' },
  providers: [Google, GitHub],
  pages: { signIn: '/signin' },
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) return true;

      // Auth.js's own OAuthAccountNotLinked redirect carries neither the email
      // nor the provider, so the lookup that lets us name one has to be ours.
      const held = await db
        .select({ provider: accounts.provider })
        .from(users)
        .innerJoin(accounts, eq(accounts.userId, users.id))
        .where(eq(users.email, user.email));

      const owner = conflictingProvider(
        held.map((row) => row.provider),
        account.provider,
      );

      return owner ? `/signin?error=account-exists&provider=${owner}` : true;
    },
  },
});
