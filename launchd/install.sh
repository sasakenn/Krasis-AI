#!/usr/bin/env bash
# バックエンド/フロントエンドをlaunchdに登録し、ログイン時に自動起動・
# 落ちたら自動再起動するようにする。何度実行しても安全(再登録される)。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHD_DIR="$ROOT_DIR/launchd"
TARGET_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$TARGET_DIR" "$ROOT_DIR/logs"

for plist in "$LAUNCHD_DIR"/*.plist; do
  name="$(basename "$plist")"
  cp -f "$plist" "$TARGET_DIR/$name"
  launchctl unload "$TARGET_DIR/$name" >/dev/null 2>&1
  launchctl load -w "$TARGET_DIR/$name"
  echo "installed + loaded: $name"
done

echo
echo "起動確認(数秒待ちます)..."
sleep 2
launchctl list | grep paperassistant || echo "見つかりません。ログを確認してください: $ROOT_DIR/logs/"

echo
for i in $(seq 1 20); do
  curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 && echo "[backend]  OK   http://127.0.0.1:8000" || echo "[backend]  まだ応答なし — $ROOT_DIR/logs/backend.log を確認してください"

for i in $(seq 1 20); do
  curl -sf http://localhost:5173 >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://localhost:5173 >/dev/null 2>&1 && echo "[frontend] OK   http://localhost:5173" || echo "[frontend] まだ応答なし — $ROOT_DIR/logs/frontend.log を確認してください"
