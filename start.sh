#!/bin/sh
set -e

DB_PATH=${DB_PATH:-/data/tokens.sqlite}

# Ensure data directory exists
mkdir -p "$(dirname "$DB_PATH")"

# Count existing tokens
TOKEN_COUNT=0
if [ -f "$DB_PATH" ]; then
    TOKEN_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tokens;" 2>/dev/null || echo 0)
fi

echo "==> Found $TOKEN_COUNT tokens in DB"

if [ "$TOKEN_COUNT" -lt 50 ]; then
    echo "==> Collecting tokens (this takes ~60s)..."
    # --tokens and --batch flags skip interactive prompts
    # --parallel 1 = single worker, safer on constrained environments
    ./token-collector --tokens 750 --batch 3 --parallel 1
else
    echo "==> Enough tokens, skipping collection"
fi

echo "==> Starting server..."
exec ./zai-bridge --db-path "$DB_PATH"
