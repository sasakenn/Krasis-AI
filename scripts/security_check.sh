#!/usr/bin/env bash
# 依存ライブラリの既知の脆弱性・更新の有無をまとめて確認する(脆弱性管理の手動チェック)。
# リリース前と月1回を目安に実行し、結果に応じて更新する。Dependabot(.github/dependabot.yml)の補助。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT_DIR/venv/bin/python"
status=0

echo "== Python: 既知の脆弱性(pip-audit) =="
if "$PY" -m pip_audit --version >/dev/null 2>&1; then
  "$PY" -m pip_audit -r "$ROOT_DIR/requirements.txt" || status=1
else
  echo "pip-audit が未インストールです。次で導入できます: $PY -m pip install pip-audit"
  status=1
fi

echo
echo "== Python: 更新可能なパッケージ =="
"$PY" -m pip list --outdated || status=1

echo
echo "== Node.js(frontend): 既知の脆弱性(npm audit) =="
(cd "$ROOT_DIR/frontend" && npm audit --audit-level=moderate) || status=1

echo
if [ "$status" -eq 0 ]; then
  echo "問題は見つかりませんでした。"
else
  echo "確認が必要な項目があります(上記を参照)。"
fi
exit "$status"
