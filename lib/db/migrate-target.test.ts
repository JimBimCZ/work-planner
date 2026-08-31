import { describe, expect, test } from 'vitest';
import { resolveMigrateTarget } from './migrate-target';

const DOCKER = 'postgres://kanban:kanban@localhost:5432/kanban';
const DEV = 'postgres://neon/dev';
const PRODUCTION = 'postgres://neon/production';

describe('resolveMigrateTarget', () => {
  test('an explicit target wins over both env files', () => {
    expect(
      resolveMigrateTarget({
        explicit: PRODUCTION,
        current: DOCKER,
        envFile: DOCKER,
        envLocalFile: DEV,
      }),
    ).toBe(PRODUCTION);
  });

  // The regression. Naming the docker database used to silently migrate the
  // Neon dev branch, because the value matched .env's and so read as "not from
  // the shell". An explicit target has no value to be confused with.
  test('an explicit target wins even when it equals what .env holds', () => {
    expect(
      resolveMigrateTarget({
        explicit: DOCKER,
        current: DOCKER,
        envFile: DOCKER,
        envLocalFile: DEV,
      }),
    ).toBe(DOCKER);
  });

  // dotenv does not overwrite an existing variable, so a value that differs
  // from .env's can only have come from the shell.
  test('a shell value that differs from .env is the shell speaking', () => {
    expect(
      resolveMigrateTarget({ current: PRODUCTION, envFile: DOCKER, envLocalFile: DEV }),
    ).toBe(PRODUCTION);
  });

  test('CI has no env files, so the environment is the only source', () => {
    expect(resolveMigrateTarget({ current: DOCKER })).toBe(DOCKER);
  });

  test('a plain run prefers .env.local, matching what Next reads', () => {
    expect(resolveMigrateTarget({ current: DOCKER, envFile: DOCKER, envLocalFile: DEV })).toBe(DEV);
  });

  test('.env is the fallback when there is no .env.local', () => {
    expect(resolveMigrateTarget({ current: DOCKER, envFile: DOCKER })).toBe(DOCKER);
  });

  test('nothing anywhere is an error, not a silent default', () => {
    expect(() => resolveMigrateTarget({})).toThrow(/DATABASE_URL_UNPOOLED/);
  });

  // A set-but-empty MIGRATE_URL means the command substitution meant to fill it
  // failed silently. Falling through to another database here is exactly the
  // regression MIGRATE_URL exists to eliminate, re-entering through a new door.
  test('an explicit target that is set but empty is an error, not a fallback', () => {
    expect(() =>
      resolveMigrateTarget({ explicit: '', current: DOCKER, envFile: DOCKER, envLocalFile: DEV }),
    ).toThrow(/MIGRATE_URL/);
  });

  test('an explicit target that is whitespace-only is an error, not a fallback', () => {
    expect(() =>
      resolveMigrateTarget({
        explicit: '   ',
        current: DOCKER,
        envFile: DOCKER,
        envLocalFile: DEV,
      }),
    ).toThrow(/MIGRATE_URL/);
  });

  test('a genuinely unset explicit target still falls back to .env.local', () => {
    expect(
      resolveMigrateTarget({
        explicit: undefined,
        current: DOCKER,
        envFile: DOCKER,
        envLocalFile: DEV,
      }),
    ).toBe(DEV);
  });
});
