#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
./venv/bin/python -m pip install pyinstaller
./venv/bin/pyinstaller --clean --noconfirm --onefile \
  --name paper-assistant-api \
  --distpath desktop/api \
  --workpath desktop/.pyinstaller \
  --specpath desktop/.pyinstaller \
  app.py
