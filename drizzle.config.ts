import { defineConfig } from 'drizzle-kit';

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
