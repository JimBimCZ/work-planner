#!/usr/bin/env bash
# Pull the Neon connection strings from Vercel into .env.local.
#
# The Neon integration only creates variables on Production and Preview, so a
# plain `vercel env pull` (which targets Development) returns nothing useful.
# We pull the chosen target, then keep only the two variables the app reads --
# the rest of the pull is Vercel build metadata (VERCEL_ENV, VERCEL_GIT_*,
# TURBO_*) that misleads the app into thinking it runs on Vercel in production.
set -euo pipefail

TARGET="${1:-production}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/.env.local"
RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT

vercel env pull "$RAW" --environment="$TARGET" --yes --cwd "$ROOT" >/dev/null

if ! grep -qE '^DATABASE_URL=' "$RAW"; then
  echo "No DATABASE_URL in the '$TARGET' environment. Check the Neon integration's variable scopes." >&2
  exit 1
fi

# Preserve anything already in .env.local that isn't one of the two we manage.
KEPT="$(grep -vE '^(#|DATABASE_URL=|DATABASE_URL_UNPOOLED=|$)' "$OUT" 2>/dev/null || true)"

{
  echo "# Neon connection strings pulled from Vercel '$TARGET' by scripts/pull-db-env.sh."
  echo "# Regenerate with: pnpm env:pull"
  grep -E '^(DATABASE_URL|DATABASE_URL_UNPOOLED)=' "$RAW"
  [ -n "$KEPT" ] && { echo; echo "$KEPT"; }
} > "$OUT"

echo "Wrote DATABASE_URL and DATABASE_URL_UNPOOLED ('$TARGET') to .env.local"
