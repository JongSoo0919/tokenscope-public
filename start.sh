#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAG_DIR="$SCRIPT_DIR/rag"
PID_DIR="$SCRIPT_DIR/.run"
RAG_PID_FILE="$PID_DIR/rag.pid"
APP_PID_FILE="$PID_DIR/tokenscope.pid"
RAG_LOG_FILE="$PID_DIR/rag.log"
APP_LOG_FILE="$PID_DIR/tokenscope.log"

cd "$SCRIPT_DIR"
mkdir -p "$PID_DIR"

# Rust toolchain
source "$HOME/.cargo/env" 2>/dev/null || true

if [ ! -d node_modules ]; then
  echo "[tokenscope] node_modules 없음 — yarn install 실행 중..."
  yarn install
fi

if [ ! -d "$RAG_DIR/.venv" ]; then
  echo "[rag] Python 가상환경 생성 중..."
  python3 -m venv "$RAG_DIR/.venv"
fi

if [ ! -f "$RAG_DIR/.env" ]; then
  cp "$RAG_DIR/.env.example" "$RAG_DIR/.env"
  echo "[rag] rag/.env 생성 완료"
fi

echo "[rag] Python 패키지 확인 중..."
PIP_DISABLE_PIP_VERSION_CHECK=1 "$RAG_DIR/.venv/bin/python" -m pip install --no-cache-dir -q -r "$RAG_DIR/requirements-ollama.txt"

if [ -f "$RAG_PID_FILE" ] && kill -0 "$(cat "$RAG_PID_FILE")" 2>/dev/null; then
  echo "[rag] 이미 실행 중: PID $(cat "$RAG_PID_FILE")"
elif lsof -tiTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[rag] 포트 8000이 이미 사용 중입니다. 기존 API를 사용합니다."
else
  echo "[rag] API 시작 중: http://127.0.0.1:8000"
  (
    cd "$SCRIPT_DIR"
    "$RAG_DIR/.venv/bin/uvicorn" tokenscope_rag.api:app --reload --host 127.0.0.1 --port 8000
  ) >"$RAG_LOG_FILE" 2>&1 &
  echo $! > "$RAG_PID_FILE"
fi

echo "[tokenscope] 앱 시작 중..."
echo "[tokenscope] 첫 실행 시 Rust 컴파일로 3-5분 걸릴 수 있습니다."

if [ -f "$APP_PID_FILE" ] && kill -0 "$(cat "$APP_PID_FILE")" 2>/dev/null; then
  echo "[tokenscope] 이미 실행 중: PID $(cat "$APP_PID_FILE")"
  exit 0
fi

if lsof -tiTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[tokenscope] 포트 1420이 이미 사용 중입니다. 기존 앱을 사용합니다."
  exit 0
fi

yarn tauri dev >"$APP_LOG_FILE" 2>&1 &
echo $! > "$APP_PID_FILE"
echo "[tokenscope] PID $(cat "$APP_PID_FILE") 로 실행 중"
echo "[tokenscope] 로그: $APP_LOG_FILE"
echo "[rag] 로그: $RAG_LOG_FILE"
echo "[tokenscope] 종료하려면 ./stop.sh 또는 Ctrl+C"

wait "$(cat "$APP_PID_FILE")"
