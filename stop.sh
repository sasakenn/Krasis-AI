#!/usr/bin/env bash
# start.sh で起動したバックエンド/フロントエンドを止める。
# pidファイルがあればそれを使い、念のためポートも解放する
# (npm run dev は $! が npm ラッパーのPIDになり SIGTERM が子(vite)に
#  伝わらないことがあるため、ポート基準のkillで確実に止める)。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti:"$port" -sTCP:LISTEN 2>/dev/null)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs -r kill 2>/dev/null
    return 0
  fi
  return 1
}

stop_backend() {
  local pid_file="$RUN_DIR/backend.pid"
  local killed_via_pid=false
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    kill "$pid" 2>/dev/null && killed_via_pid=true
    rm -f "$pid_file"
  fi
  sleep 1
  if kill_port 8000 || [ "$killed_via_pid" = true ]; then
    echo "[backend]  stopped"
  else
    echo "[backend]  was not running"
  fi
}

stop_frontend() {
  rm -f "$RUN_DIR/frontend.pid"
  if kill_port 5173; then
    echo "[frontend] stopped"
  else
    echo "[frontend] was not running"
  fi
}

stop_backend
stop_frontend
