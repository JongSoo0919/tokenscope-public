#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Rust toolchain
source "$HOME/.cargo/env" 2>/dev/null || true

# Install JS deps if missing
if [ ! -d node_modules ]; then
  echo "[tokenscope] node_modules 없음 — yarn install 실행 중..."
  yarn install
fi

echo "[tokenscope] 앱 시작 중..."
echo "[tokenscope] 첫 실행 시 Rust 컴파일로 3-5분 걸릴 수 있습니다."

yarn tauri dev &
echo $! > /tmp/tokenscope.pid
echo "[tokenscope] PID $(cat /tmp/tokenscope.pid) 로 실행 중"
echo "[tokenscope] 종료하려면 ./stop.sh 또는 Ctrl+C"

wait
