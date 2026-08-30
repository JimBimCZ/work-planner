import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit auto-loads .env only, while Next.js gives .env.local precedence.
// Without this the app would talk to Neon while migrations hit the docker
// Postgres in .env. Overriding is deliberate: process.loadEnvFile refuses to
// replace values .env has already put in process.env.
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (match) process.env[match[1]] = match[2];
  }
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
