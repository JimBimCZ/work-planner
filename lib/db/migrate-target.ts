export type MigrateSources = {
  /** `MIGRATE_URL`. Never written to an env file, so its presence is unambiguous. */
  explicit?: string;
  /** `DATABASE_URL_UNPOOLED` as it stands after drizzle-kit has loaded `.env`. */
  current?: string;
  /** `DATABASE_URL_UNPOOLED` as `.env` spells it. */
  envFile?: string;
  /** `DATABASE_URL_UNPOOLED` as `.env.local` spells it. */
  envLocalFile?: string;
};

/**
 * Which database `pnpm db:migrate` writes to.
 *
 * drizzle-kit loads `.env` into `process.env` before the config evaluates, and
 * dotenv does not overwrite a variable the shell already set. So a value that
 * *differs* from `.env`'s must have come from the shell — but a value equal to
 * it is undecidable, and that is the case that matters: naming the docker
 * Postgres that `.env` documents used to read as "not from the shell" and
 * silently migrate the Neon dev branch instead, while still printing
 * "migrations applied successfully!". `MIGRATE_URL` exists so there is a way to
 * say which database that carries no value to be confused with.
 *
 * A `MIGRATE_URL` that is *set* but empty or blank is treated as an error, not
 * as absent: `process.env.MIGRATE_URL` is `undefined` when the variable was
 * never set and `''` when a command substitution meant to fill it — such as
 * `MIGRATE_URL="$(npx neonctl@4 connection-string main --project-id <id>)"` —
 * failed. Falling through to another database in that case is exactly the
 * regression this file exists to eliminate, re-entering through a new door.
 */
export function resolveMigrateTarget({
  explicit,
  current,
  envFile,
  envLocalFile,
}: MigrateSources): string {
  if (explicit !== undefined && explicit.trim() === '') {
    throw new Error(
      'MIGRATE_URL is set but empty. This usually means the command substitution meant to ' +
        'fill it failed — check it ran and printed a connection string. Nothing was migrated.',
    );
  }
  if (explicit) return explicit;
  if (current !== undefined && current !== envFile) return current;

  const url = envLocalFile ?? envFile ?? current;
  if (!url) {
    throw new Error(
      'No migration target: set MIGRATE_URL, or DATABASE_URL_UNPOOLED in .env.local or .env',
    );
  }
  return url;
}
