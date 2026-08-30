#!/usr/bin/env bash
# Create a Neon dev branch and point Vercel's Development environment at it.
#
# The Vercel-managed Neon integration only scopes DATABASE_URL to Production and
# Preview, so local development would otherwise share the production branch.
# This creates a separate branch and registers it as Development-scoped in
# Vercel, so `pnpm env:pull development` gives an isolated database.
#
# Requires Neon auth: `npx neonctl auth`, or NEON_API_KEY in the environment.
set -euo pipefail

BRANCH="${1:-dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEON=(npx --yes neonctl@4)

# The project id lives in the Production env the integration created.
RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT
vercel env pull "$RAW" --environment=production --yes --cwd "$ROOT" >/dev/null
PROJECT_ID="$(sed -nE 's/^NEON_PROJECT_ID="?([^"]*)"?$/\1/p' "$RAW")"
[ -n "$PROJECT_ID" ] || { echo "NEON_PROJECT_ID not found in the Production environment." >&2; exit 1; }
echo "Neon project: $PROJECT_ID"

if "${NEON[@]}" branches list --project-id "$PROJECT_ID" --output json \
     | grep -q "\"name\": *\"$BRANCH\""; then
  echo "Branch '$BRANCH' already exists, reusing it."
else
  echo "Creating branch '$BRANCH'..."
  "${NEON[@]}" branches create --project-id "$PROJECT_ID" --name "$BRANCH" --output json >/dev/null
fi

POOLED="$("${NEON[@]}" connection-string "$BRANCH" --project-id "$PROJECT_ID" --pooled)"
DIRECT="$("${NEON[@]}" connection-string "$BRANCH" --project-id "$PROJECT_ID")"
[ -n "$POOLED" ] && [ -n "$DIRECT" ] || { echo "Could not read connection strings for '$BRANCH'." >&2; exit 1; }

# Piped rather than passed as --value so the credentials stay out of the process list.
printf '%s' "$POOLED" | vercel env add DATABASE_URL development --force --cwd "$ROOT" >/dev/null
printf '%s' "$DIRECT" | vercel env add DATABASE_URL_UNPOOLED development --force --cwd "$ROOT" >/dev/null
echo "Set DATABASE_URL and DATABASE_URL_UNPOOLED on Vercel (Development)."

bash "$ROOT/scripts/pull-db-env.sh" development
echo
echo "Next: pnpm db:migrate  (applies the schema to the '$BRANCH' branch)"
