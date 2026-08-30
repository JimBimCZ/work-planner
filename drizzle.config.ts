import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';
import { resolveMigrateTarget } from './lib/db/migrate-target';

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
// MIGRATE_URL names the target outright: `MIGRATE_URL=<production> pnpm
// db:migrate` migrates what it names, and that is how production is migrated.
// resolveMigrateTarget carries the reasoning about why an explicit variable is
// needed at all.
const url = resolveMigrateTarget({
  explicit: process.env.MIGRATE_URL,
  current: process.env.DATABASE_URL_UNPOOLED,
  envFile: parseEnvFile('.env').get('DATABASE_URL_UNPOOLED'),
  envLocalFile: parseEnvFile('.env.local').get('DATABASE_URL_UNPOOLED'),
});

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
});
