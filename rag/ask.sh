#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -x ".venv/bin/python" ]; then
  echo "[rag] .venv/bin/python 없음 — 프로젝트 루트에서 ./start.sh 를 먼저 실행하세요." >&2
  exit 1
fi

exec .venv/bin/python src/app.py "$@"
