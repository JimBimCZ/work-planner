import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

// The dev server re-evaluates modules on every hot reload, which would leak a
// pool per reload. Production gets a fresh module per cold start, so the cache
// is deliberately dev-only.
const globalForDb = globalThis as unknown as { pool?: Pool };
const pool =
  globalForDb.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
}

export const db = drizzle({ client: pool, schema });
