#!/bin/sh
set -e

echo "==> Collecting tokens..."
./token-collector --tokens 750 --batch 3 --headed=false

echo "==> Starting server..."
exec ./zai-bridge --db-path ./tokens.sqlite
