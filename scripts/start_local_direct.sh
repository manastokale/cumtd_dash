#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"

cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo ".env is missing."
  echo "Create .env with at least:"
  echo "API_MODE=direct"
  echo "API_KEY=your_mtd_key_here"
  echo "REFRESH_INTERVAL_MS=1000"
  exit 1
fi

if ! grep -Eq '^\s*API_MODE\s*=\s*direct\s*$' .env; then
  echo ".env must contain API_MODE=direct for direct local mode."
  exit 1
fi

python3 scripts/build_gtfs_cache.py
if ! grep -q '"apiMode":"direct"' data/runtime-config.json; then
  echo "Generated data/runtime-config.json is not in direct mode."
  echo "Check .env and make sure it contains API_MODE=direct"
  exit 1
fi
echo "Starting direct local mode on http://127.0.0.1:${PORT}"
python3 -m http.server "$PORT"
