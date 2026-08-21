#!/usr/bin/env bash
# バックエンド/フロントエンドが起動しているか確認する。
set -uo pipefail

check() {
  local name="$1" url="$2"
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "[$name]  running  - $url"
  else
    echo "[$name]  stopped"
  fi
}

check backend  http://127.0.0.1:8000/health
check frontend http://localhost:5173
