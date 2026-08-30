import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

function parseEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

// drizzle-kit auto-loads .env only, while Next.js gives .env.local precedence.
// Without this the app would talk to Neon while migrations hit the docker
// Postgres in .env — the two drift with no error.
//
// A real environment variable outranks both, so a one-off
// `DATABASE_URL_UNPOOLED=<production> pnpm db:migrate` reaches what it names.
// This used to override unconditionally, which meant that command silently
// migrated the .env.local database and still reported success. drizzle-kit has
// already loaded .env by the time this module evaluates, so "came from the
// shell" cannot be read off process.env alone — it means present there and not
// merely equal to what .env put there.
const dotEnv = parseEnvFile('.env');
for (const [key, value] of parseEnvFile('.env.local')) {
  const fromShell = key in process.env && process.env[key] !== dotEnv.get(key);
  if (!fromShell) process.env[key] = value;
}

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error('DATABASE_URL_UNPOOLED is not set');
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
});
