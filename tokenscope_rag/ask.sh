#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RAG_DIR="$ROOT/rag"

if [ ! -x "$RAG_DIR/.venv/bin/python" ]; then
  echo "[rag] .venv/bin/python 없음 — 프로젝트 루트에서 ./start.sh 를 먼저 실행하세요." >&2
  exit 1
fi

exec "$RAG_DIR/.venv/bin/python" "$RAG_DIR/src/app.py" "$@"
