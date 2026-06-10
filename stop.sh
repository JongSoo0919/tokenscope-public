#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$SCRIPT_DIR/.run"
APP_PID_FILE="$PID_DIR/tokenscope.pid"
RAG_PID_FILE="$PID_DIR/rag.pid"

stop_pid_file() {
  local name="$1"
  local file="$2"

  if [ ! -f "$file" ]; then
    echo "[$name] PID 파일 없음"
    return
  fi

  local pid
  pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "[$name] PID $pid 종료 중..."
    kill "$pid" 2>/dev/null || true
    echo "[$name] 종료 완료"
  else
    echo "[$name] PID $pid 는 이미 종료되어 있음"
  fi
  rm -f "$file"
}

stop_pid_file "tokenscope" "$APP_PID_FILE"
stop_pid_file "rag" "$RAG_PID_FILE"

echo "[tokenscope] 정리 완료"
