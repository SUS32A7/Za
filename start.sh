#!/bin/sh
set -e

DB_PATH=${DB_PATH:-/data/tokens.sqlite}

TOKEN_COUNT=0
if [ -f "$DB_PATH" ]; then
    TOKEN_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM tokens;" 2>/dev/null || echo 0)
fi

echo "==> Found $TOKEN_COUNT tokens in DB"

if [ "$TOKEN_COUNT" -lt 50 ]; then
    echo "==> Collecting tokens..."
    ./token-collector --tokens 750 --batch 3 --parallel 1
else
    echo "==> Skipping collection, enough tokens"
fi

echo "==> Starting server..."
exec ./zai-bridge --db-path "$DB_PATH"
