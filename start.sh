#!/usr/bin/env bash
# バックエンド(FastAPI)とフロントエンド(Vite)をバックグラウンドで起動する。
# 既に起動済みのポートはスキップするので、何度実行しても安全(多重起動しない)。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"
RUN_DIR="$ROOT_DIR/.run"
mkdir -p "$LOG_DIR" "$RUN_DIR"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

port_listening() {
  lsof -ti:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

start_backend() {
  if port_listening 8000; then
    echo "[backend]  already listening on :8000 — skipping"
    return
  fi
  # exec で直接 python プロセスに置き換えるので、$! がそのまま uvicorn の実PIDになる
  # (stop.sh で reload 用の子プロセスごと確実に止めるために必要)
  (cd "$ROOT_DIR" && exec ./venv/bin/python app.py) >> "$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$BACKEND_PID_FILE"
  echo "[backend]  starting (pid $(cat "$BACKEND_PID_FILE")) — logs: $LOG_DIR/backend.log"
}

start_frontend() {
  if port_listening 5173; then
    echo "[frontend] already listening on :5173 — skipping"
    return
  fi
  (cd "$ROOT_DIR/frontend" && exec npm run dev) >> "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$FRONTEND_PID_FILE"
  echo "[frontend] starting (pid $(cat "$FRONTEND_PID_FILE")) — logs: $LOG_DIR/frontend.log"
}

start_backend
start_frontend

echo
echo "waiting for health checks..."

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 1
done
if curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "[backend]  OK   http://127.0.0.1:8000"
else
  echo "[backend]  NOT RESPONDING — check $LOG_DIR/backend.log"
fi

for _ in $(seq 1 30); do
  curl -sf http://localhost:5173 >/dev/null 2>&1 && break
  sleep 1
done
if curl -sf http://localhost:5173 >/dev/null 2>&1; then
  echo "[frontend] OK   http://localhost:5173"
else
  echo "[frontend] NOT RESPONDING — check $LOG_DIR/frontend.log"
fi
