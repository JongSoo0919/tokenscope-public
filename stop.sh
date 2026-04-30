#!/usr/bin/env bash

PID_FILE="/tmp/tokenscope.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "[tokenscope] PID $PID 종료 중..."
    kill "$PID"
    rm -f "$PID_FILE"
    echo "[tokenscope] 종료 완료"
  else
    echo "[tokenscope] PID $PID 는 이미 종료되어 있음"
    rm -f "$PID_FILE"
  fi
else
  # PID 파일 없으면 프로세스 이름으로 탐색
  PIDS=$(pgrep -f "tauri dev" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "[tokenscope] tauri dev 프로세스 종료 중: $PIDS"
    echo "$PIDS" | xargs kill
    echo "[tokenscope] 종료 완료"
  else
    echo "[tokenscope] 실행 중인 프로세스를 찾을 수 없습니다"
  fi
fi
