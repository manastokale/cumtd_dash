#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8788}"

cd "$ROOT_DIR"

if [[ ! -f .dev.vars ]]; then
  echo ".dev.vars is missing."
  echo "Copy .dev.vars.example to .dev.vars and set your API_KEY."
  exit 1
fi

echo "Starting Cloudflare Pages local mode on http://127.0.0.1:${PORT}"
npx wrangler pages dev . --port "$PORT"
