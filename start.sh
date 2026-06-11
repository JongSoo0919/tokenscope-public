#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAG_DIR="$SCRIPT_DIR/rag"
PID_DIR="$SCRIPT_DIR/.run"
RAG_PID_FILE="$PID_DIR/rag.pid"
APP_PID_FILE="$PID_DIR/tokenscope.pid"
RAG_LOG_FILE="$PID_DIR/rag.log"
APP_LOG_FILE="$PID_DIR/tokenscope.log"
ASK_REPL=false
RUN_CLI=false
CLI_ARGS=()
APP_ALREADY_RUNNING=false

usage() {
  cat <<'EOF'
Usage:
  ./start.sh [--ask] [--cli [cli args...]]

Options:
  --ask, --repl   RAG API와 앱을 띄운 뒤 Wiki 질문 REPL을 같은 터미널에서 실행합니다.
  --cli           앱 시작 전에 TokenScope CLI를 한 번 실행합니다.
                  인자가 없으면: list --provider cursor --limit 5
  --help          도움말을 출력합니다.

Examples:
  ./start.sh
  ./start.sh --ask
  ./start.sh --cli list --provider cursor --limit 5
  ./start.sh --ask --cli analyze --provider codex
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ask|--repl)
      ASK_REPL=true
      shift
      ;;
    --cli)
      RUN_CLI=true
      shift
      CLI_ARGS=("$@")
      break
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[tokenscope] 알 수 없는 옵션: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ "$RUN_CLI" = true ] && [ "${#CLI_ARGS[@]}" -eq 0 ]; then
  CLI_ARGS=(list --provider cursor --limit 5)
fi

cd "$SCRIPT_DIR"
mkdir -p "$PID_DIR"

if [ ! -f "$RAG_DIR/requirements-ollama.txt" ]; then
  echo "[rag] 서브모듈 초기화 중..."
  git submodule update --init --recursive rag
fi

# Rust toolchain
if [ -f "$HOME/.cargo/env" ]; then
  source "$HOME/.cargo/env"
fi

PYTHON_BIN="python3"
if [ -x "/opt/homebrew/bin/python3" ]; then
  PYTHON_BIN="/opt/homebrew/bin/python3"
fi

if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "[rag] Python 3.10 이상이 필요합니다. 현재: $("$PYTHON_BIN" --version 2>&1)"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[tokenscope] node_modules 없음 — yarn install 실행 중..."
  yarn install
fi

if [ "$RUN_CLI" = true ]; then
  echo "[tokenscope-cli] 실행 중: yarn cli ${CLI_ARGS[*]}"
  yarn cli "${CLI_ARGS[@]}"
fi

if [ -x "$RAG_DIR/.venv/bin/python" ] &&
  ! "$RAG_DIR/.venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  BACKUP_VENV="$RAG_DIR/.venv.py$(date +%Y%m%d%H%M%S)"
  echo "[rag] 기존 Python 3.9 가상환경 감지 — $BACKUP_VENV 로 이동"
  mv "$RAG_DIR/.venv" "$BACKUP_VENV"
fi

if [ ! -d "$RAG_DIR/.venv" ]; then
  echo "[rag] Python 가상환경 생성 중..."
  "$PYTHON_BIN" -m venv "$RAG_DIR/.venv"
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
  APP_ALREADY_RUNNING=true
elif lsof -tiTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[tokenscope] 포트 1420이 이미 사용 중입니다. 기존 앱을 사용합니다."
  APP_ALREADY_RUNNING=true
else
  yarn tauri dev >"$APP_LOG_FILE" 2>&1 &
  echo $! > "$APP_PID_FILE"
  echo "[tokenscope] PID $(cat "$APP_PID_FILE") 로 실행 중"
fi

echo "[tokenscope] 로그: $APP_LOG_FILE"
echo "[rag] 로그: $RAG_LOG_FILE"
echo "[tokenscope] 종료하려면 ./stop.sh 또는 Ctrl+C"

if [ "$ASK_REPL" = true ]; then
  echo "[rag] Wiki 질문 REPL 시작 중 — 종료는 exit"
  "$SCRIPT_DIR/tokenscope_rag/ask.sh"
fi

if [ "$APP_ALREADY_RUNNING" = false ]; then
  wait "$(cat "$APP_PID_FILE")"
fi
