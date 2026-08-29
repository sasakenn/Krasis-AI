#!/usr/bin/env bash
# launchdへの登録を解除し、自動起動を止める(start.sh/stop.shでの手動運用に戻る)。
set -uo pipefail

TARGET_DIR="$HOME/Library/LaunchAgents"
found=false

for plist in "$TARGET_DIR"/com.sasahiromichi.paperassistant.*.plist; do
  [ -e "$plist" ] || continue
  found=true
  launchctl unload "$plist" >/dev/null 2>&1
  rm -f "$plist"
  echo "removed: $(basename "$plist")"
done

if [ "$found" = false ]; then
  echo "登録されているジョブは見つかりませんでした(既にアンインストール済みかもしれません)"
fi
